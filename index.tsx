import React, { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import html2canvas from "html2canvas";

// Initialize Gemini API with safe environment variable access for Vite/Vercel
// Vercel/Vite uses import.meta.env.VITE_API_KEY. 'process' is not available in the browser.
const getApiKey = () => {
  // Check for Vite environment variable
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_KEY) {
    return (import.meta as any).env.VITE_API_KEY;
  }
  // Fallback for Node-like environments or if defined globally
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    return process.env.API_KEY;
  }
  return "";
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

// Define the JSON schema for the poem response
const poemSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    found: {
      type: Type.BOOLEAN,
      description: "Set to true if a Tang dynasty poem matching the query is found, false otherwise.",
    },
    title: {
      type: Type.OBJECT,
      properties: {
        chinese: { type: Type.STRING },
        pinyin: { type: Type.STRING },
        english: { type: Type.STRING },
      },
    },
    author: {
      type: Type.OBJECT,
      properties: {
        name_chinese: { type: Type.STRING },
        name_english: { type: Type.STRING },
        dynasty_era: { type: Type.STRING, description: "Specific era within Tang (e.g., High Tang)" },
      },
    },
    verses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          chinese: { type: Type.STRING },
          pinyin: { type: Type.STRING },
          english: { type: Type.STRING },
        },
      },
    },
    analysis: {
      type: Type.STRING,
      description: "A brief, insightful analysis of the poem's meaning, imagery, and historical context.",
    },
  },
  required: ["found"],
};

interface PoemData {
  found: boolean;
  title?: {
    chinese: string;
    pinyin: string;
    english: string;
  };
  author?: {
    name_chinese: string;
    name_english: string;
    dynasty_era: string;
  };
  verses?: {
    chinese: string;
    pinyin: string;
    english: string;
  }[];
  analysis?: string;
}

// Helper functions for Audio Decoding
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  // Ensure even byte length for Int16Array
  if (data.length % 2 !== 0) {
     data = data.subarray(0, data.length - 1);
  }

  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App = () => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [poem, setPoem] = useState<PoemData | null>(null);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  
  const poemRef = useRef<HTMLDivElement>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setImageLoading(false);
    setError(null);
    setPoem(null);
    setBgImage(null);
    setIsSpeaking(false);
    
    try {
      const model = "gemini-2.5-flash";
      // Expanded prompt to explicitly handle phrases/lines
      const prompt = `Identify the Tang Dynasty poem associated with this query: "${query}".
      The query might be the poem's title, a specific line or phrase from the poem (in Chinese or English), or a subject.
      If the query is a line from a poem, identify the source poem and provide the full details for that poem.
      Provide the full text in Traditional Chinese, Pinyin, and English translation. 
      Include the author and a brief analysis.`;

      const result = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          systemInstruction: "You are an expert scholar of Classical Chinese Literature, specifically the Tang Dynasty. Your goal is to present poems accurately and beautifully. If the user provides a famous line, you must retrieve the full poem it belongs to.",
          responseMimeType: "application/json",
          responseSchema: poemSchema,
        },
      });

      const text = result.text;
      if (text) {
        const data = JSON.parse(text) as PoemData;
        setPoem(data);
        
        if (!data.found) {
          setError("Could not find a specific Tang Dynasty poem matching that title or phrase. Please try a different keyword.");
          setLoading(false);
        } else {
          // Content found, stop main loading to show text, start image generation
          setLoading(false);
          generateWatercolor(data);
        }
      } else {
        setError("The scholars remained silent. Please try again.");
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError("An error occurred while consulting the archives.");
      setLoading(false);
    }
  };

  const generateWatercolor = async (data: PoemData) => {
    if (!data.title || !data.analysis) return;
    
    setImageLoading(true);
    try {
      const imagePrompt = `A traditional Chinese watercolor painting, ink wash style (shuimohua). 
      Depicting the imagery and mood of the poem titled "${data.title.english}". 
      Context: ${data.analysis.slice(0, 300)}.
      Aesthetic: Traditional Chinese ink wash painting, visible brush strokes, rich colors on rice paper texture, atmospheric, ancient Chinese art style. No text in image.`;

      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: imagePrompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '4:3',
        },
      });

      const base64ImageBytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (base64ImageBytes) {
        const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
        setBgImage(imageUrl);
      }
    } catch (err) {
      console.error("Failed to generate image:", err);
      // We don't show a user error here as the main content is already visible
    } finally {
      setImageLoading(false);
    }
  };

  const handleReadAloud = async () => {
    if (!poem || isSpeaking) return;
    setIsSpeaking(true);

    // Initialize AudioContext. We do not set the sampleRate in the constructor
    // to let the browser use the system's native sample rate (e.g. 44.1k or 48k).
    // We will handle the 24k sample rate from Gemini in the buffer creation.
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextClass();

    try {
      const textToRead = `
        ${poem.title?.chinese}。
        ${poem.author?.name_chinese}。
        ${poem.verses?.map(v => v.chinese).join('。 ')}
      `;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: textToRead }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' }, 
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        // Explicitly resume context to handle browser autoplay policies
        await audioContext.resume();

        const audioBuffer = await decodeAudioData(
          decode(base64Audio),
          audioContext,
          24000, // Gemini TTS output is 24kHz
          1
        );
        
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.start();
        
        source.onended = () => {
          setIsSpeaking(false);
          audioContext.close(); // Clean up context
        };
      } else {
        setIsSpeaking(false);
        audioContext.close();
      }

    } catch (error) {
      console.error("TTS Error", error);
      setIsSpeaking(false);
      audioContext.close();
    }
  };

  const handleSnapshot = async () => {
    if (!poemRef.current) return;
    setIsSnapshotting(true);

    try {
      const canvas = await html2canvas(poemRef.current, {
        scale: 2, // Higher resolution
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
      });

      const image = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = image;
      link.download = `${poem?.title?.english?.replace(/\s+/g, '_') || 'tang_poem'}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Snapshot failed:", err);
      alert("Failed to create snapshot. Please try again.");
    } finally {
      setIsSnapshotting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden font-serif bg-stone-100">
      {/* Background Decoration */}
      <div className="absolute top-0 left-0 w-full h-full opacity-5 pointer-events-none z-0">
         <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M0 0 L100 100 M100 0 L0 100" stroke="currentColor" strokeWidth="0.5" />
         </svg>
      </div>

      <div className="z-10 w-full max-w-3xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl md:text-5xl font-bold text-stone-800 tracking-tight">
            Tang Poetry Archives
          </h1>
          <p className="text-stone-600 italic text-lg font-chinese">
            唐诗三百首
          </p>
          <p className="text-stone-500 text-sm mt-2">
            created by CHONG TECK VOON 
          </p>
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearch} className="relative max-w-xl mx-auto w-full group z-20">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-stone-400 group-focus-within:text-stone-600 transition-colors" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a title or a line (e.g., 'Moonlight before my bed')"
            className="block w-full pl-10 pr-3 py-4 border border-stone-300 rounded-none bg-stone-50 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-500 focus:border-stone-500 sm:text-lg shadow-sm transition-all"
          />
          <button
            type="submit"
            disabled={loading}
            className="absolute inset-y-0 right-0 px-6 bg-stone-800 text-stone-50 hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium tracking-wide text-white"
          >
            {loading ? "Seeking..." : "Search"}
          </button>
        </form>

        {/* Error Message */}
        {error && (
          <div className="rounded-md bg-red-50 p-4 border-l-4 border-red-800 animate-fade-in">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Search Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content Display */}
        {poem && poem.found && poem.title && (
          <div ref={poemRef} className="group bg-white shadow-2xl border border-stone-200 relative overflow-hidden animate-slide-up min-h-[600px]">
             
             {/* Generated Watercolor Background */}
             <div className="absolute inset-0 z-0 transition-opacity duration-1000 ease-in-out">
                {bgImage ? (
                  <img 
                    src={bgImage} 
                    alt="Watercolor interpretation of the poem" 
                    className="w-full h-full object-cover opacity-100"
                  />
                ) : (
                  <div className={`w-full h-full bg-stone-50 ${imageLoading ? 'animate-pulse' : ''}`}></div>
                )}
                {/* Gradient overlay to ensure text readability */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/90 via-white/40 to-white/90"></div>
             </div>

             {/* Loading Indicator for Image */}
             {imageLoading && !bgImage && (
               <div className="absolute top-2 right-2 z-20 flex items-center space-x-2 bg-white/80 px-3 py-1 rounded-full text-xs text-stone-500 shadow-sm border border-stone-100 backdrop-blur-sm">
                 <span className="animate-spin h-3 w-3 border-2 border-stone-400 border-t-transparent rounded-full"></span>
                 <span>Painting scene...</span>
               </div>
             )}

            {/* Custom Name Stamp: 庄德文 */}
            <div className="absolute top-8 right-6 md:right-10 md:top-10 z-50 pointer-events-none opacity-100 mix-blend-multiply drop-shadow-sm">
                <div className="bg-red-900 text-stone-100 px-2 py-3 rounded-sm -rotate-2 shadow-md flex flex-col items-center justify-center w-10 md:w-12 border-[3px] border-red-800/80 ring-1 ring-red-900/20 transition-transform duration-500 ease-out group-hover:scale-110 group-hover:rotate-0 group-hover:shadow-lg">
                     <span className="font-chinese font-bold text-xl md:text-2xl leading-none mb-1 drop-shadow-md">庄</span>
                     <span className="font-chinese font-bold text-xl md:text-2xl leading-none mb-1 drop-shadow-md">德</span>
                     <span className="font-chinese font-bold text-xl md:text-2xl leading-none drop-shadow-md">文</span>
                </div>
            </div>

            {/* Poem Content */}
            <div className="relative z-10 p-8 md:p-12">
              <div className="text-center mb-10 border-b border-stone-300/50 pb-8 bg-white/40 backdrop-blur-[2px] rounded-lg p-4">
                <h2 className="text-3xl font-chinese font-bold text-stone-900 mb-2 drop-shadow-sm">
                  {poem.title.chinese}
                </h2>
                <h3 className="text-xl text-stone-700 mb-1 italic font-serif font-semibold">
                  {poem.title.english}
                </h3>
                <p className="text-sm text-stone-500 font-mono uppercase tracking-wider">
                  {poem.title.pinyin}
                </p>
                
                <div className="mt-6 flex justify-center items-center space-x-2 text-stone-700">
                  <span className="h-px w-8 bg-stone-400"></span>
                  <span className="font-chinese text-lg text-stone-900 font-medium">{poem.author?.name_chinese}</span>
                  <span className="text-sm font-semibold">({poem.author?.name_english})</span>
                  <span className="h-px w-8 bg-stone-400"></span>
                </div>
                <p className="text-xs text-stone-600 mt-1 uppercase tracking-widest font-medium mb-4">{poem.author?.dynasty_era}</p>

                {/* Control Buttons */}
                <div className="flex justify-center gap-4 flex-wrap" data-html2canvas-ignore="true">
                  {/* Read Aloud Button */}
                  <button 
                    onClick={handleReadAloud}
                    disabled={isSpeaking}
                    className="px-4 py-1.5 bg-stone-800/5 hover:bg-stone-800/10 text-stone-700 text-sm rounded-full flex items-center transition-all border border-stone-300 hover:border-stone-400 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                    aria-label="Read poem aloud in Chinese"
                  >
                    {isSpeaking ? (
                      <>
                        <span className="flex h-2 w-2 relative mr-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-stone-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-stone-600"></span>
                        </span>
                        Playing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        Read Aloud
                      </>
                    )}
                  </button>

                  {/* Snapshot Button */}
                  <button 
                    onClick={handleSnapshot}
                    disabled={isSnapshotting}
                    className="px-4 py-1.5 bg-stone-800/5 hover:bg-stone-800/10 text-stone-700 text-sm rounded-full flex items-center transition-all border border-stone-300 hover:border-stone-400 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
                    aria-label="Save poem as image"
                  >
                    {isSnapshotting ? (
                       <span className="animate-pulse flex items-center">
                         <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                         Saving...
                       </span>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Snapshot
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-8 max-w-2xl mx-auto">
                {poem.verses?.map((verse, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 group hover:bg-white/60 transition-colors p-4 rounded-lg backdrop-blur-sm bg-white/40 shadow-sm">
                    <div className="text-center md:text-right border-b md:border-b-0 md:border-r border-stone-300/50 pb-2 md:pb-0 md:pr-6">
                      <p className="text-2xl font-chinese text-stone-900 leading-relaxed font-bold">
                        {verse.chinese}
                      </p>
                      <p className="text-sm text-stone-600 font-mono mt-1 font-medium">
                        {verse.pinyin}
                      </p>
                    </div>
                    <div className="text-center md:text-left flex items-center md:pl-2">
                      <p className="text-lg text-stone-900 italic leading-relaxed font-serif font-medium">
                        {verse.english}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {poem.analysis && (
                <div className="mt-12 pt-8 border-t border-stone-300/50">
                  <h4 className="text-center text-sm font-bold text-stone-600 uppercase tracking-widest mb-4 bg-white/60 inline-block px-4 py-1 rounded-full mx-auto block">
                    Analysis & Context
                  </h4>
                  <div className="bg-white/70 p-6 rounded-xl backdrop-blur-md shadow-sm border border-white/20">
                    <p className="text-stone-900 leading-loose text-justify text-lg font-serif font-medium">
                      {poem.analysis}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="mt-auto py-6 text-stone-400 text-xs text-center relative z-10">
        Generated by Google Gemini API & Imagen
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);