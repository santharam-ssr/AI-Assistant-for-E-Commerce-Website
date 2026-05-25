"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ShoppingCart, Search, RefreshCw, Sparkles, ShoppingBag, Trash, Minus, Plus, Filter, Tag, Check, X, LogIn, LogOut, UserPlus, User } from "lucide-react";
import GazeAgentWidget from "@/components/GazeAgentWidget";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Home() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({ items: [] });
  const [sessionId, setSessionId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [selectedProductForModal, setSelectedProductForModal] = useState(null);

  // Authentication State
  const [currentUser, setCurrentUser] = useState(null);
  const [authToken, setAuthToken] = useState("");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [usernameInput, setUsernameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");

  // Fetch user profile info
  const fetchUserProfile = useCallback(async (token) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (response.ok) {
        const userData = await response.json();
        setCurrentUser(userData);
      } else {
        localStorage.removeItem("gaze_auth_token");
        setAuthToken("");
        setCurrentUser(null);
      }
    } catch (e) {
      console.error("Failed to restore user session:", e);
    }
  }, []);

  // Initialize a persistent session ID and restore authentication state
  useEffect(() => {
    let sessId = localStorage.getItem("gaze_session_id");
    if (!sessId) {
      sessId = "sess_" + Math.random().toString(36).substring(2, 15);
      localStorage.setItem("gaze_session_id", sessId);
    }
    setSessionId(sessId);

    const savedToken = localStorage.getItem("gaze_auth_token");
    if (savedToken) {
      setAuthToken(savedToken);
      fetchUserProfile(savedToken);
    }
  }, [fetchUserProfile]);

  // Fetch products
  const fetchProducts = useCallback(async (search = "", category = "") => {
    setIsLoadingProducts(true);
    try {
      let url = `${API_URL}/api/products`;
      const params = [];
      if (search) params.push(`search=${encodeURIComponent(search)}`);
      if (category) params.push(`category=${encodeURIComponent(category)}`);
      if (params.length > 0) url += "?" + params.join("&");

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setProducts(data);
      }
    } catch (e) {
      console.error("Error fetching products:", e);
    } finally {
      setIsLoadingProducts(false);
    }
  }, []);

  // Fetch cart
  const fetchCart = useCallback(async () => {
    if (!sessionId) return;
    try {
      const headers = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${API_URL}/api/cart/${sessionId}`, { headers });
      if (response.ok) {
        const data = await response.json();
        setCart(data);
      }
    } catch (e) {
      console.error("Error fetching cart:", e);
    }
  }, [sessionId, authToken]);

  // Synchronize initial load
  useEffect(() => {
    if (sessionId) {
      fetchProducts(searchQuery, selectedCategory);
      fetchCart();
    }
  }, [sessionId, authToken, fetchProducts, fetchCart]);

  // Handle Search Input Submission
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchProducts(searchQuery, selectedCategory);
  };

  // Add Item to Cart (Main Page Grid trigger)
  const handleAddToCart = async (productId) => {
    try {
      const headers = {
        "Content-Type": "application/json",
      };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${API_URL}/api/cart/${sessionId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          product_id: productId,
          quantity: 1,
        }),
      });
      if (response.ok) {
        fetchCart();
        setIsCartOpen(true); // Open cart to show visual confirmation
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Update Cart Item quantity
  const handleUpdateQty = async (productId, newQty) => {
    if (newQty < 1) return;
    try {
      const headers = {
        "Content-Type": "application/json",
      };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${API_URL}/api/cart/${sessionId}/items/${productId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          quantity: newQty,
        }),
      });
      if (response.ok) {
        fetchCart();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Delete Cart Item
  const handleDeleteCartItem = async (productId) => {
    try {
      const headers = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${API_URL}/api/cart/${sessionId}/items/${productId}`, {
        method: "DELETE",
        headers,
      });
      if (response.ok) {
        fetchCart();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Registration and Login form submission
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    const url = authMode === "login" 
      ? `${API_URL}/api/auth/login` 
      : `${API_URL}/api/auth/register`;
    
    const body = authMode === "login"
      ? { username: usernameInput, password: passwordInput }
      : { username: usernameInput, email: emailInput, password: passwordInput };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      if (!response.ok) {
        setAuthError(data.detail || "Authentication failed. Please check credentials.");
        return;
      }

      // Success
      localStorage.setItem("gaze_auth_token", data.access_token);
      setAuthToken(data.access_token);
      setCurrentUser(data.user);
      
      // Merge guest cart
      if (sessionId) {
        try {
          const mergeResponse = await fetch(`${API_URL}/api/cart/merge/${sessionId}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${data.access_token}`
            }
          });
          if (mergeResponse.ok) {
            console.log("Guest cart successfully merged.");
          }
        } catch (mergeError) {
          console.error("Error merging guest cart:", mergeError);
        }
      }

      // Reset fields and close modal
      setUsernameInput("");
      setEmailInput("");
      setPasswordInput("");
      setIsAuthModalOpen(false);
    } catch (error) {
      console.error("Auth error:", error);
      setAuthError("Server connection lost. Verify backend is running.");
    }
  };

  // Handle Logout
  const handleLogout = () => {
    localStorage.removeItem("gaze_auth_token");
    setAuthToken("");
    setCurrentUser(null);
    setCart({ items: [] });
    
    // Regenerate session id
    const newSessId = "sess_" + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("gaze_session_id", newSessId);
    setSessionId(newSessId);
  };

  // Reset / Seed catalog endpoint trigger
  const handleResetCatalog = async () => {
    setIsSeeding(true);
    try {
      const response = await fetch(`${API_URL}/api/seed`, { method: "POST" });
      if (response.ok) {
        fetchProducts();
        fetchCart();
        alert("Store catalog reset and RAG vectors re-seeded successfully!");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSeeding(false);
    }
  };

  // Compute Cart Subtotal
  const cartSubtotal = cart.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      
      {/* Dynamic Ambient Background Gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -z-10 animate-pulse"></div>
      <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-3xl -z-10"></div>
      <div className="absolute bottom-10 left-10 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl -z-10"></div>

      {/* Sticky Header with Glassmorphism */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-white/5 shadow-sm transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg">
              <Sparkles size={20} className="text-white animate-spin-slow" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Gaze<span className="font-light text-blue-400">Store</span>
              </span>
              <p className="text-[10px] text-slate-400 tracking-wider font-semibold uppercase">Premium Shop</p>
            </div>
          </div>

          {/* Catalog Reset Seeder Tool */}
          <div className="hidden md:flex items-center gap-4">
            <button
              onClick={handleResetCatalog}
              disabled={isSeeding}
              className="flex items-center gap-2 text-xs font-semibold bg-slate-900 border border-white/10 hover:border-blue-500 text-slate-300 hover:text-white px-3 py-2 rounded-xl transition-all duration-300 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={14} className={isSeeding ? "animate-spin" : ""} />
              {isSeeding ? "Syncing..." : "Re-Seed Catalog & Vector DB"}
            </button>
          </div>

          {/* Cart Icon and Widget Activator */}
          <div className="flex items-center gap-4">
            {/* Auth Button or User Badge */}
            {currentUser ? (
              <div className="flex items-center gap-3 bg-slate-900 border border-white/10 rounded-xl p-1.5 pr-3 shadow-md">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 border border-white/10 flex items-center justify-center font-bold text-xs text-white uppercase shadow-sm">
                  {currentUser.username.substring(0, 2)}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-[10px] font-bold text-white leading-tight">{currentUser.username}</p>
                  <p className="text-[8px] text-slate-400 font-semibold leading-none">{currentUser.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                  title="Sign Out"
                >
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                  setIsAuthModalOpen(true);
                }}
                className="flex items-center gap-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2.5 rounded-xl border border-white/10 hover:border-blue-500 transition-all active:scale-95 cursor-pointer shadow-md"
              >
                <LogIn size={14} className="text-blue-400" />
                <span>Sign In</span>
              </button>
            )}

            {/* Cart Trigger */}
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative p-3 bg-slate-900 border border-white/10 hover:border-blue-500 rounded-xl transition-all duration-300 shadow-md group active:scale-95 cursor-pointer"
            >
              <ShoppingCart size={18} className="text-slate-300 group-hover:text-blue-400 transition-colors" />
              {cart.items.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow-md animate-bounce">
                  {cart.items.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              )}
            </button>

            {/* Spacer for Chat FAB Widget */}
            <div className="w-32"></div>
          </div>

        </div>
      </header>

      {/* Main E-commerce Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        
        {/* Banner / Hero Section */}
        <section className="relative overflow-hidden rounded-3xl bg-slate-900 border border-white/5 p-8 sm:p-12 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/10 via-transparent to-transparent"></div>
          
          <div className="flex-1 space-y-4 max-w-xl relative z-10">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full border border-blue-500/20">
              <Sparkles size={12} /> Next-Gen AI Shopping Live
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Elevate Your Shopping with <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Voice & AI Assistance</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-medium">
              Click the **Ask GazeAI** floating helper at the top-right! Command it using normal speech or text to search products, query catalog specs, and modify your cart instantly.
            </p>
            
            {/* Search Bar inside Hero */}
            <form onSubmit={handleSearchSubmit} className="pt-2 flex items-center gap-2 max-w-md">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Ask vectors: 'Find waterproof rolltop backpacks'..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-all font-semibold"
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              </div>
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-5 py-3 rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
              >
                Search
              </button>
            </form>
          </div>

          <div className="relative w-full max-w-sm aspect-video md:aspect-square flex-shrink-0 flex items-center justify-center">
            {/* Gradient Orb */}
            <div className="absolute w-64 h-64 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-full blur-3xl opacity-30 animate-pulse"></div>
            <ShoppingBag className="w-32 h-32 text-blue-500 animate-bounce relative z-10 opacity-75" strokeWidth={1} />
          </div>
        </section>

        {/* Category Filters Bar */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-slate-900 border border-white/5 p-1 rounded-xl w-fit">
            {[
              { id: "", name: "All Catalog" },
              { id: "shoes", name: "Footwear" },
              { id: "fashion", name: "Fashion" },
              { id: "electronics", name: "Electronics" },
              { id: "bags", name: "Bags" },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  fetchProducts(searchQuery, cat.id);
                }}
                className={`text-xs font-semibold px-4 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer ${
                  selectedCategory === cat.id
                    ? "bg-blue-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {searchQuery && (
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <span>Showing results for</span>
              <span className="font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/10">"{searchQuery}"</span>
              <button
                onClick={() => {
                  setSearchQuery("");
                  fetchProducts("", selectedCategory);
                }}
                className="text-red-400 hover:underline ml-1 cursor-pointer"
              >
                Clear
              </button>
            </div>
          )}
        </section>

        {/* Products Grid */}
        <section>
          {isLoadingProducts ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <RefreshCw className="animate-spin text-blue-500" size={40} />
              <p className="text-sm font-semibold text-slate-400">Consulting RAG search catalog...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20 bg-slate-900 border border-white/5 rounded-3xl p-8">
              <ShoppingBag className="mx-auto w-16 h-16 text-slate-600 mb-4" strokeWidth={1} />
              <h3 className="text-lg font-bold text-white mb-1">No products found</h3>
              <p className="text-sm text-slate-400 max-w-sm mx-auto mb-6">
                Try refining your search terms or tap "Re-Seed Catalog" in the header to initialize the mock dataset!
              </p>
              <button
                onClick={handleResetCatalog}
                className="bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl border border-white/5 transition-all"
              >
                Initialize Dataset
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((prod) => (
                <div
                  key={prod.id}
                  onClick={() => setSelectedProductForModal(prod)}
                  className="bg-slate-900 border border-white/5 hover:border-blue-500/30 rounded-2xl overflow-hidden shadow-lg group hover:shadow-[0_8px_30px_rgba(59,130,246,0.1)] transition-all duration-300 flex flex-col cursor-pointer hover:scale-[1.01]"
                >
                  {/* Image container */}
                  <div className="relative overflow-hidden aspect-video bg-slate-850">
                    <img
                      src={prod.image_url || "/placeholder.png"}
                      alt={prod.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <span className="absolute top-4 left-4 bg-slate-950/80 backdrop-blur-md text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full border border-white/10 text-slate-300">
                      {prod.category}
                    </span>
                  </div>

                  {/* Body details */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-2">
                      <h3 className="font-bold text-white tracking-wide text-sm group-hover:text-blue-400 transition-colors">
                        {prod.name}
                      </h3>
                      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                        {prod.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase">Price</span>
                        <p className="text-lg font-bold text-emerald-400">₹{prod.price}</p>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCart(prod.id);
                        }}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
                      >
                        <Plus size={14} /> Add to Cart
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-white/5 bg-slate-950 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500 font-medium">
            &copy; 2026 GazeAI Premium E-commerce Assistant. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-xs text-slate-400 font-semibold">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
          </div>
        </div>
      </footer>

      {/* Sliding right-side Shopping Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
          <div className="absolute inset-0 overflow-hidden">
            
            {/* Backdrop Overlay */}
            <div
              onClick={() => setIsCartOpen(false)}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
            ></div>

            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <div className="pointer-events-auto w-screen max-w-md bg-slate-900 border-l border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col animate-in slide-in-from-right duration-300">
                
                {/* Drawer Header */}
                <div className="px-6 py-5 bg-slate-950/50 border-b border-white/5 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                    <ShoppingCart className="text-blue-500" size={20} />
                    Shopping Cart
                  </h2>
                  <button
                    onClick={() => setIsCartOpen(false)}
                    className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Items List */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {cart.items.length === 0 ? (
                    <div className="text-center py-20 space-y-3">
                      <ShoppingBag className="mx-auto w-12 h-12 text-slate-700" strokeWidth={1} />
                      <p className="text-sm font-semibold text-slate-400">Your cart is empty.</p>
                      <button
                        onClick={() => setIsCartOpen(false)}
                        className="text-xs text-blue-400 hover:text-blue-300 font-bold underline cursor-pointer"
                      >
                        Start shopping catalog
                      </button>
                    </div>
                  ) : (
                    cart.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-4 p-3 bg-slate-850/80 border border-white/5 rounded-xl"
                      >
                        <img
                          src={item.product.image_url || "/placeholder.png"}
                          alt={item.product.name}
                          className="w-16 h-16 rounded-lg object-cover bg-slate-700 flex-shrink-0"
                        />
                        
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-white truncate">{item.product.name}</h4>
                          <p className="text-[10px] text-slate-400 capitalize">{item.product.category}</p>
                          <p className="text-xs font-bold text-emerald-400 mt-1">₹{item.product.price}</p>
                          
                          {/* Quantity control */}
                          <div className="flex items-center gap-2 mt-2 w-fit bg-slate-900 border border-white/5 rounded-lg p-0.5">
                            <button
                              onClick={() => handleUpdateQty(item.product.id, item.quantity - 1)}
                              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                            >
                              <Minus size={10} />
                            </button>
                            <span className="text-xs font-bold text-white px-2">{item.quantity}</span>
                            <button
                              onClick={() => handleUpdateQty(item.product.id, item.quantity + 1)}
                              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                            >
                              <Plus size={10} />
                            </button>
                          </div>
                        </div>

                        {/* Delete item button */}
                        <button
                          onClick={() => handleDeleteCartItem(item.product.id)}
                          className="p-2 text-slate-400 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer"
                          title="Remove item"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Drawer Footer Billing Info */}
                {cart.items.length > 0 && (
                  <div className="p-6 bg-slate-950/50 border-t border-white/5 space-y-4">
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span className="text-slate-400">Total Items:</span>
                      <span className="text-white">
                        {cart.items.reduce((sum, item) => sum + item.quantity, 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-base font-bold">
                      <span className="text-white">Subtotal:</span>
                      <span className="text-emerald-400">₹{cartSubtotal.toFixed(2)}</span>
                    </div>

                    <button
                      onClick={() => alert("Premium checkout process is simulated! Checkout success.")}
                      className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-blue-500/15 transition-all active:scale-95 cursor-pointer text-center text-xs tracking-wider uppercase font-extrabold"
                    >
                      Checkout Now
                    </button>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProductForModal && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200" role="dialog" aria-modal="true">
          {/* Backdrop Overlay */}
          <div
            onClick={() => setSelectedProductForModal(null)}
            className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm transition-opacity"
          ></div>

          {/* Modal Container */}
          <div className="relative w-full max-w-2xl bg-slate-900 border border-white/10 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col md:flex-row animate-in zoom-in-95 duration-200 max-h-[90vh] md:max-h-none">
            {/* Close Button */}
            <button
              onClick={() => setSelectedProductForModal(null)}
              className="absolute top-4 right-4 z-10 p-2 text-slate-400 hover:text-white bg-slate-950/60 hover:bg-slate-950/90 rounded-full border border-white/5 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>

            {/* Left/Top: Product Image */}
            <div className="relative w-full md:w-1/2 aspect-video md:aspect-square bg-slate-950 flex-shrink-0">
              <img
                src={selectedProductForModal.image_url || "/placeholder.png"}
                alt={selectedProductForModal.name}
                className="w-full h-full object-cover"
              />
              <span className="absolute top-4 left-4 bg-blue-600 text-white text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full border border-white/10 shadow-md">
                {selectedProductForModal.category}
              </span>
            </div>

            {/* Right/Bottom: Product Details Info */}
            <div className="p-6 md:p-8 flex-1 flex flex-col justify-between overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Product ID: #{selectedProductForModal.id}</span>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-tight mt-1">
                    {selectedProductForModal.name}
                  </h2>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Price</span>
                  <p className="text-2xl font-extrabold text-emerald-400">₹{selectedProductForModal.price}</p>
                </div>

                <hr className="border-white/5" />

                <div className="space-y-2">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Description</span>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-medium">
                    {selectedProductForModal.description}
                  </p>
                </div>
              </div>

              <div className="pt-6 mt-6 border-t border-white/5 flex items-center gap-4">
                <button
                  onClick={() => {
                    handleAddToCart(selectedProductForModal.id);
                    setSelectedProductForModal(null);
                  }}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-blue-500/15 transition-all active:scale-95 cursor-pointer text-center text-xs tracking-wider uppercase font-extrabold flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> Add to Cart
                </button>
                <button
                  onClick={() => setSelectedProductForModal(null)}
                  className="px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-white/5 transition-all text-xs font-bold tracking-wider uppercase cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Floating AI Assistant Widget */}
      {sessionId && (
        <GazeAgentWidget
          sessionId={sessionId}
          authToken={authToken}
          cartCount={cart.items.reduce((sum, item) => sum + item.quantity, 0)}
          onProductAdded={fetchCart}
          triggerViewCart={() => setIsCartOpen(true)}
          onProductClick={setSelectedProductForModal}
        />
      )}

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200" role="dialog" aria-modal="true">
          {/* Backdrop Overlay */}
          <div
            onClick={() => setIsAuthModalOpen(false)}
            className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm transition-opacity"
          ></div>

          {/* Modal Container */}
          <div className="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 p-6 sm:p-8 space-y-6">
            
            {/* Close Button */}
            <button
              onClick={() => setIsAuthModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white bg-slate-950/60 hover:bg-slate-950/90 rounded-full border border-white/5 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>

            {/* Title / Logo */}
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg mx-auto">
                <Sparkles size={24} className="text-white" />
              </div>
              <h2 className="text-2xl font-extrabold text-white tracking-tight leading-tight">
                {authMode === "login" ? "Welcome Back to Gaze" : "Create Gaze Account"}
              </h2>
              <p className="text-xs text-slate-400 font-medium">
                {authMode === "login" 
                  ? "Access your private cart, order history, and custom AI chat logs."
                  : "Join Gaze to secure private cart state and unlock persistent voice commands."}
              </p>
            </div>

            {/* Auth Mode Tabs */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                }}
                className={`flex-1 text-xs font-bold py-2.5 rounded-lg transition-all cursor-pointer ${
                  authMode === "login"
                    ? "bg-blue-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                }}
                className={`flex-1 text-xs font-bold py-2.5 rounded-lg transition-all cursor-pointer ${
                  authMode === "register"
                    ? "bg-blue-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Register
              </button>
            </div>

            {/* Auth Error Widget */}
            {authError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl p-3.5 text-xs font-semibold leading-relaxed">
                {authError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Username</label>
                <input
                  type="text"
                  required
                  placeholder="john_doe"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all font-semibold"
                />
              </div>

              {authMode === "register" && (
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="john@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all font-semibold"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all font-semibold"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-blue-500/15 transition-all active:scale-95 cursor-pointer text-center text-xs tracking-wider uppercase font-extrabold flex items-center justify-center gap-2 mt-2"
              >
                {authMode === "login" ? <LogIn size={14} /> : <UserPlus size={14} />}
                <span>{authMode === "login" ? "Sign In to Gaze" : "Register to Gaze"}</span>
              </button>
            </form>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "login" ? "register" : "login");
                  setAuthError("");
                }}
                className="text-[11px] text-slate-400 hover:text-blue-400 font-semibold underline cursor-pointer"
              >
                {authMode === "login" 
                  ? "Don't have an account? Sign up instead" 
                  : "Already registered? Login to your account"}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
