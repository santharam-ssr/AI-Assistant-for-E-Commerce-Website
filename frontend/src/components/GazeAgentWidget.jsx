"use client";

import React, { useState, useEffect, useRef } from "react";
import { Bot, Mic, MicOff, Send, X, ShoppingBag, Plus, Sparkles, Volume2, VolumeX, ArrowRight, User } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function GazeAgentWidget({ sessionId, authToken, cartCount, onProductAdded, triggerViewCart, onProductClick }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);

  // Fetch and restore chat history from DB on load/sessionId change
  useEffect(() => {
    if (!sessionId) return;

    const fetchHistory = async () => {
      try {
        const headers = {};
        if (authToken) {
          headers["Authorization"] = `Bearer ${authToken}`;
        }
        const response = await fetch(`${API_URL}/api/chat/${sessionId}`, { headers });
        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            // Map messages from backend format to frontend format with unique IDs
            const mappedHistory = data.map((msg, index) => ({
              id: msg.id || `history-${index}-${Math.random().toString(36).substring(2, 6)}`,
              sender: msg.sender,
              text: msg.text,
              products: msg.products || null,
              timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
            }));
            setMessages(mappedHistory);
          } else {
            // Default welcome message if history is empty
            setMessages([
              {
                id: "welcome",
                sender: "bot",
                text: "Hi! I am **GazeAI**, your premium shopping assistant. 💫\n\nHow can I help you today? You can search for items (e.g., *'Find running shoes under ₹5000'*), ask for details, or say *'Show my cart'*. Try clicking the microphone to talk!",
                timestamp: new Date(),
              }
            ]);
          }
        }
      } catch (e) {
        console.error("Failed to fetch chat history:", e);
        // Fallback to welcome message on connection failure
        setMessages([
          {
            id: "welcome",
            sender: "bot",
            text: "Hi! I am **GazeAI**, your premium shopping assistant. 💫\n\nHow can I help you today? You can search for items (e.g., *'Find running shoes under ₹5000'*), ask for details, or say *'Show my cart'*. Try clicking the microphone to talk!",
            timestamp: new Date(),
          }
        ]);
      }
    };

    fetchHistory();
  }, [sessionId, authToken]);

  // Scroll to bottom of chat when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Setup Web Speech API for Speech-to-Text
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = "en-US";

        rec.onstart = () => {
          setIsListening(true);
        };

        rec.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            setInputValue(transcript);
            handleSendMessage(transcript);
          }
        };

        rec.onerror = (err) => {
          console.error("Speech recognition error:", err);
          setIsListening(false);
        };

        rec.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = rec;
      }
    }
  }, []);

  // Speech Synthesis for Text-to-Speech
  const speakText = (text) => {
    if (!ttsEnabled || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel(); // Stop any active speech
      
      // Clean up markdown/bold characters for cleaner TTS pronunciation
      const cleanText = text
        .replace(/\*\*|__|\*|_/g, "")
        .replace(/₹/g, "Rupees ")
        .replace(/-\s+/g, ", ");

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("TTS Speech error:", e);
    }
  };

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Please try Google Chrome or Safari!");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  const handleSendMessage = async (textToSend = null) => {
    const text = textToSend !== null ? textToSend : inputValue;
    if (!text.trim()) return;

    setInputValue("");
    
    // Add user message locally
    const userMsg = {
      id: Math.random().toString(),
      sender: "user",
      text: text,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const headers = {
        "Content-Type": "application/json",
      };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          session_id: sessionId,
          message: text,
          use_voice: false
        })
      });

      if (!response.ok) throw new Error("Backend connection failed");
      const data = await response.json();

      const botMsg = {
        id: Math.random().toString(),
        sender: "bot",
        text: data.reply,
        products: data.products || null,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, botMsg]);
      
      // Speak out the bot's response
      speakText(data.reply);

      // If user requested cart updates or cart views, sync parent state
      const lowerText = text.toLowerCase();
      if (lowerText.includes("add") || lowerText.includes("remove") || lowerText.includes("cart") || lowerText.includes("clear")) {
        onProductAdded();
      }
      if (lowerText.includes("show my cart") || lowerText.includes("view cart") || lowerText.includes("what is in my cart")) {
        // Expand the main cart drawer
        triggerViewCart();
      }

    } catch (e) {
      console.error("Chat error:", e);
      setMessages(prev => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: "bot",
          text: "I'm having trouble connecting to GazeAI backend. Please check that the server is running on port 8000!",
          timestamp: new Date()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestClick = (suggestion) => {
    handleSendMessage(suggestion);
  };

  const renderMarkdown = (text) => {
    // Simple formatter for bold text and list bullets
    return text.split("\n").map((line, i) => {
      let content = line;
      // Bold formatter **text**
      content = content.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');
      // Italic formatter *text*
      content = content.replace(/\*(.*?)\*/g, '<em class="text-slate-300">$1</em>');

      if (line.startsWith("- ")) {
        return (
          <li key={i} className="ml-4 list-disc text-slate-200 py-0.5" dangerouslySetInnerHTML={{ __html: content.substring(2) }} />
        );
      }
      return (
        <p key={i} className="mb-2 last:mb-0 leading-relaxed text-slate-200" dangerouslySetInnerHTML={{ __html: content }} />
      );
    });
  };

  return (
    <>
      {/* Floating Action Button (FAB) at top-right or bottom-right */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium px-4 py-3 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.3)] backdrop-blur-sm border border-white/10 transition-all duration-300 hover:scale-105 active:scale-95 group"
        aria-label="Toggle Assistant"
      >
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
        </span>
        <Bot size={20} className="group-hover:rotate-12 transition-transform duration-300" />
        <span className="text-sm font-semibold tracking-wide">Ask GazeAI</span>
      </button>

      {/* Main Glassmorphic Assistant Modal */}
      {isOpen && (
        <div className="fixed top-24 right-6 w-96 max-w-[calc(100vw-2rem)] h-[600px] z-50 flex flex-col bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-300 ease-out animate-in slide-in-from-top-12 duration-200">
          
          {/* Header */}
          <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                <Sparkles size={20} className="text-white animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-white tracking-wide text-sm flex items-center gap-1.5">
                  GazeAI Assistant
                </h3>
                <p className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping"></span>
                  Active Agent Brain
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* TTS Toggle Button */}
              <button
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                title={ttsEnabled ? "Disable Text-to-Speech" : "Enable Text-to-Speech"}
              >
                {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              
              {/* Close Button */}
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Chat Feed Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-700">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 max-w-[85%] ${
                  msg.sender === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                }`}
              >
                {/* Avatar Icon */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-md ${
                    msg.sender === "user"
                      ? "bg-slate-700"
                      : "bg-gradient-to-tr from-blue-600 to-indigo-600"
                  }`}
                >
                  {msg.sender === "user" ? <User size={14} /> : <Bot size={14} />}
                </div>

                {/* Message Bubble */}
                <div className="space-y-3">
                  <div
                    className={`p-3.5 rounded-2xl text-sm shadow-md leading-relaxed ${
                      msg.sender === "user"
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-tr-none"
                        : "bg-slate-800/80 border border-white/5 text-slate-100 rounded-tl-none"
                    }`}
                  >
                    {renderMarkdown(msg.text)}
                  </div>

                  {/* If product listings are attached inside bot response, render interactive cards */}
                  {msg.products && msg.products.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      {msg.products.map((prod) => (
                        <div
                          key={prod.id}
                          onClick={() => onProductClick && onProductClick(prod)}
                          className="flex items-center gap-3 p-2 bg-slate-800/90 border border-white/10 rounded-xl hover:border-blue-500 hover:bg-slate-800 hover:scale-[1.02] cursor-pointer transition-all duration-300 group shadow-md"
                        >
                          <img
                            src={prod.image_url || "/placeholder.png"}
                            alt={prod.name}
                            className="w-14 h-14 rounded-lg object-cover bg-slate-700 flex-shrink-0 group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-white truncate group-hover:text-blue-400 transition-colors">{prod.name}</h4>
                            <p className="text-[10px] text-slate-400 capitalize">{prod.category}</p>
                            <p className="text-xs font-semibold text-emerald-400 mt-0.5">₹{prod.price}</p>
                          </div>
                          
                          <button
                            onClick={async (e) => {
                              e.stopPropagation(); // Avoid triggering details modal
                              try {
                                const headers = { "Content-Type": "application/json" };
                                if (authToken) {
                                  headers["Authorization"] = `Bearer ${authToken}`;
                                }
                                const response = await fetch(`${API_URL}/api/cart/${sessionId}`, {
                                  method: "POST",
                                  headers,
                                  body: JSON.stringify({ product_id: prod.id, quantity: 1 }),
                                });
                                if (response.ok) {
                                  onProductAdded();
                                  alert(`Added ${prod.name} to cart!`);
                                }
                              } catch (e) {
                                console.error(e);
                              }
                            }}
                            className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center justify-center transition-all shadow-md active:scale-95 cursor-pointer"
                            title="Add to Cart"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Pulsing bot-thinking indicator */}
            {isLoading && (
              <div className="flex gap-3 max-w-[85%]">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white flex-shrink-0">
                  <Bot size={14} />
                </div>
                <div className="bg-slate-800/80 border border-white/5 p-3.5 rounded-2xl rounded-tl-none flex items-center gap-1 shadow-md">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "300ms" }}></span>
                </div>
              </div>
            )}
            
            <div ref={chatEndRef} />
          </div>

          {/* Quick suggestions area */}
          {messages.length === 1 && !isLoading && (
            <div className="px-4 py-2 flex flex-wrap gap-1.5 bg-slate-900 border-t border-white/5">
              {[
                "Find cargo pants",
                "Show smartwatches",
                "Add red running shoes to cart",
                "Show my cart"
              ].map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestClick(chip)}
                  className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-2.5 py-1.5 rounded-full border border-white/5 transition-all active:scale-95 flex items-center gap-1 shadow-sm"
                >
                  <ArrowRight size={10} className="text-blue-500" />
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Microphone soundwave animation overlay */}
          {isListening && (
            <div className="absolute inset-x-0 bottom-[68px] h-20 bg-slate-950/90 flex flex-col items-center justify-center border-t border-blue-500/20 backdrop-blur-md animate-in slide-in-from-bottom duration-200">
              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-2 animate-pulse">
                Listening to your command...
              </p>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((wave) => (
                  <span
                    key={wave}
                    className="w-1.5 bg-blue-500 rounded-full animate-pulse"
                    style={{
                      height: `${10 + Math.random() * 25}px`,
                      animationDuration: `${0.4 + Math.random() * 0.4}s`,
                      animationIterationCount: "infinite"
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Chat Footer Input Area */}
          <div className="p-3 border-t border-white/10 bg-slate-900 flex items-center gap-2">
            {/* STT Microphone Trigger Button */}
            <button
              onClick={toggleListening}
              className={`p-3.5 rounded-xl flex items-center justify-center transition-all shadow-md active:scale-95 ${
                isListening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/5"
              }`}
              title={isListening ? "Stop listening" : "Start Voice command"}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>

            {/* Input Element */}
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder={isListening ? "Listening..." : "Search, ask questions, edit cart..."}
              disabled={isListening}
              className="flex-1 bg-slate-800 border border-white/5 rounded-xl px-3.5 py-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 transition-all font-medium"
            />

            {/* Send Message Button */}
            <button
              onClick={() => handleSendMessage()}
              className="p-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl flex items-center justify-center transition-all shadow-md active:scale-95"
            >
              <Send size={16} />
            </button>
          </div>

        </div>
      )}
    </>
  );
}
