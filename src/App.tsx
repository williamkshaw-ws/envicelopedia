/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CatalogItem, BallModel, BallColor, BallCondition, FittingRecommendation } from "./types";
import { VICE_BALLS_SPECS, COLOR_STYLES, SCRAPED_BALLS } from "./constants";
import AddMissingBallForm from "./components/AddMissingBallForm";
import BallVisual from "./components/BallVisual";
import { 
  Search, 
  Sparkles, 
  Database, 
  PlusSquare, 
  Settings, 
  Pencil, 
  Trash2, 
  Layers, 
  Activity, 
  Info, 
  Lock, 
  Unlock, 
  HelpCircle, 
  Compass, 
  Calendar,
  Filter,
  CheckCircle,
  Menu,
  X
} from "lucide-react";

import { auth, db, isFirebaseConfigured } from "./firebase";
import AuthModal from "./components/AuthModal";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, doc, setDoc, deleteDoc } from "firebase/firestore";

export default function App() {
  // Theme state: 'light' | 'dark'
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem("envicelopedia_theme") as 'light' | 'dark') || "dark";
  });

  // Active tab state
  const [activeTab, setActiveTab] = useState<"timeline" | "models" | "catalog" | "finder" | "admin">("timeline");

  // Firebase Auth states
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [userRole, setUserRole] = useState<"Admin" | "User">("User");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [adminUnlockPassword, setAdminUnlockPassword] = useState("");
  const [isGuestAdminUnlocked, setIsGuestAdminUnlocked] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Search & Catalog filters
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModelFilter, setSelectedModelFilter] = useState("ALL");
  const [selectedColorFilter, setSelectedColorFilter] = useState("ALL");
  const [selectedYearFilter, setSelectedYearFilter] = useState("ALL");

  // Finder Quiz State
  const [quizDistance, setQuizDistance] = useState<string>("");
  const [quizPriority, setQuizPriority] = useState<string>("");
  const [quizFinish, setQuizFinish] = useState<string>("");
  const [quizResult, setQuizResult] = useState<FittingRecommendation | null>(null);

  // Admin Editing states
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [showFormSuccess, setShowFormSuccess] = useState(false);

  // Expanded card state in Catalog tab
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // Toast Notification Trigger
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Apply visual theme
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("envicelopedia_theme", theme);
  }, [theme]);

  // Auth observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        // If Firebase is fully configured, check for admin privileges
        if (isFirebaseConfigured) {
          try {
            const userDoc = await getDocs(collection(db!, "users"));
            // Look for matching user profile
            const profile = userDoc.docs.find(d => d.id === user.uid);
            if (profile && profile.data().role === "Admin") {
              setUserRole("Admin");
            } else {
              setUserRole("User");
            }
          } catch (e) {
            console.error("Error fetching admin profile", e);
            setUserRole("User");
          }
        } else {
          // Fallback admin role in local/no-auth-rules mode
          setUserRole("Admin");
        }
      } else {
        setUserRole("User");
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch catalog on mount and on database updates
  const fetchCatalog = async () => {
    setIsLoadingCatalog(true);
    try {
      const res = await fetch("/api/catalog");
      if (res.ok) {
        const data = await res.json();
        // If backend returned empty catalog, fallback to SCRAPED_BALLS local list
        setCatalog(data.length > 0 ? data : SCRAPED_BALLS);
      } else {
        setCatalog(SCRAPED_BALLS);
      }
    } catch (e) {
      console.warn("Failed to fetch from backend API. Falling back to static data.");
      setCatalog(SCRAPED_BALLS);
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  // Sync catalog updates
  const handleAddCatalogItem = async (newItem: Omit<CatalogItem, "id">) => {
    try {
      const res = await fetch("/api/catalog", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": currentUser?.uid || "admin-guest"
        },
        body: JSON.stringify(newItem)
      });
      if (res.ok) {
        showToast("Ball release successfully indexed in catalog!");
        fetchCatalog();
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to add ball.");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to submit new ball release.", "error");
    }
  };

  const handleUpdateCatalogItem = async (id: string, updatedFields: Partial<CatalogItem>) => {
    try {
      const res = await fetch(`/api/catalog/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": currentUser?.uid || "admin-guest"
        },
        body: JSON.stringify(updatedFields)
      });
      if (res.ok) {
        showToast("Ball specifications updated successfully!");
        setEditingItem(null);
        fetchCatalog();
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to update ball specs.");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to update specs.", "error");
    }
  };

  const handleDeleteCatalogItem = async (id: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this ball specs sheet?")) return;
    try {
      const res = await fetch(`/api/catalog/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
          "x-user-id": currentUser?.uid || "admin-guest"
        }
      });
      if (res.ok) {
        showToast("Ball specs sheet deleted from encyclopedia.");
        fetchCatalog();
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete.");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to delete item.", "error");
    }
  };

  // Timeline Releases Selector
  const timelineData = useMemo(() => {
    const grouped: Record<string, CatalogItem[]> = {};
    catalog.forEach(item => {
      const year = item.year || "Classic / Unknown";
      if (!grouped[year]) grouped[year] = [];
      grouped[year].push(item);
    });
    // Sort years descending
    return Object.keys(grouped)
      .sort((a, b) => {
        if (a === "Classic / Unknown") return 1;
        if (b === "Classic / Unknown") return -1;
        return b.localeCompare(a);
      })
      .map(year => ({
        year,
        items: grouped[year]
      }));
  }, [catalog]);

  // Explore Catalog Filters
  const filteredCatalog = useMemo(() => {
    return catalog.filter(item => {
      const matchesSearch = 
        item.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.color.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.variation || "").toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesModel = selectedModelFilter === "ALL" || item.model === selectedModelFilter;
      const matchesColor = selectedColorFilter === "ALL" || item.color === selectedColorFilter;
      const matchesYear = selectedYearFilter === "ALL" || (item.year || "Classic") === selectedYearFilter;

      return matchesSearch && matchesModel && matchesColor && matchesYear;
    });
  }, [catalog, searchQuery, selectedModelFilter, selectedColorFilter, selectedYearFilter]);

  const uniqueModels = useMemo(() => Array.from(new Set(catalog.map(c => c.model))), [catalog]);
  const uniqueColors = useMemo(() => Array.from(new Set(catalog.map(c => c.color))), [catalog]);
  const uniqueYears = useMemo(() => Array.from(new Set(catalog.map(c => c.year || "Classic"))).sort().reverse(), [catalog]);

  // Ball Finder Fitting logic
  const handleRunQuiz = () => {
    if (!quizDistance || !quizPriority || !quizFinish) {
      showToast("Please answer all 3 questions to find your recommendation.", "error");
      return;
    }

    let result: FittingRecommendation;
    if (quizDistance === "long") {
      if (quizPriority === "spin" || quizFinish === "gloss") {
        result = {
          model: BallModel.PRO_PLUS,
          title: "VICE PRO PLUS",
          reason: "Perfect for high swing speeds seeking maximum distance from the tee while retaining brilliant control and backspin on green approach shots. Uses a 4-layer construction with an extra-thin BJ13 Cast Urethane cover.",
          specs: {
            compression: 105,
            layers: 4,
            cover: "Cast Urethane (Extra-Thin BJ13)",
            feel: "Firm",
            swingSpeed: "> 110 mph",
            driverDistance: "> 250 yds"
          }
        };
      } else {
        result = {
          model: BallModel.PRO,
          title: "VICE PRO",
          reason: "The quintessential tour-caliber flagship ball. Provides excellent distance off the tee with an incredibly responsive, buttery feel on chips and wedges. Designed for medium-to-high swing speeds using a 3-layer cast urethane construction.",
          specs: {
            compression: 95,
            layers: 3,
            cover: "Cast Urethane (Extra-Thin BJ13)",
            feel: "Soft",
            swingSpeed: "95 - 110 mph",
            driverDistance: "220 - 250 yds"
          }
        };
      }
    } else if (quizDistance === "medium") {
      if (quizFinish === "matte" || quizPriority === "feel") {
        result = {
          model: BallModel.PRO_SOFT,
          title: "VICE PRO SOFT",
          reason: "Specifically engineered for moderate swing speeds. This 3-layer matte cast urethane offers outstanding distance coupled with an ultra-soft sensation. Excellent choice for players seeking high visibility and feel.",
          specs: {
            compression: 80,
            layers: 3,
            cover: "Matte Cast Urethane",
            feel: "Extra Soft",
            swingSpeed: "< 95 mph",
            driverDistance: "180 - 220 yds"
          }
        };
      } else if (quizPriority === "spin") {
        result = {
          model: BallModel.PRO,
          title: "VICE PRO",
          reason: "Optimizes premium urethane performance at average speeds. High green-side spin while keeping driver spin minimal for straighter flight paths.",
          specs: {
            compression: 95,
            layers: 3,
            cover: "Cast Urethane (Extra-Thin BJ13)",
            feel: "Soft",
            swingSpeed: "95 - 110 mph",
            driverDistance: "220 - 250 yds"
          }
        };
      } else {
        result = {
          model: BallModel.TOUR,
          title: "VICE TOUR",
          reason: "Balanced premium play & indestructible durability. Featuring a 3-piece Surlyn construction, this ball provides high durability combined with great overall distance.",
          specs: {
            compression: 90,
            layers: 3,
            cover: "Surlyn (DuPont Surlyn)",
            feel: "Medium-Soft",
            swingSpeed: "All Speeds",
            driverDistance: "All Distances"
          }
        };
      }
    } else {
      if (quizPriority === "feel") {
        result = {
          model: BallModel.PRO_SOFT,
          title: "VICE PRO SOFT",
          reason: "Allows players with moderate to slow swing speeds to fully compress the core, unlocking tour-caliber feel and high launch options off the turf.",
          specs: {
            compression: 80,
            layers: 3,
            cover: "Matte Cast Urethane",
            feel: "Extra Soft",
            swingSpeed: "< 95 mph",
            driverDistance: "< 220 yds"
          }
        };
      } else {
        result = {
          model: BallModel.DRIVE,
          title: "VICE DRIVE",
          reason: "Designed to optimize ball speed and fly completely straight, even on off-center hits. Soft energy core maximizes rollouts with a highly durable Surlyn cover.",
          specs: {
            compression: 95,
            layers: 2,
            cover: "Surlyn Tough Shell",
            feel: "Firm",
            swingSpeed: "Low-to-Medium",
            driverDistance: "Straight Power"
          }
        };
      }
    }

    setQuizResult(result);
  };

  const handleGuestAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminUnlockPassword === "admin" || adminUnlockPassword === "envicelopedia") {
      setIsGuestAdminUnlocked(true);
      showToast("Guest Admin controls unlocked!");
    } else {
      showToast("Incorrect password.", "error");
    }
  };

  const isAdminEnabled = userRole === "Admin" || isGuestAdminUnlocked;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-[#2563eb] selection:text-white transition-colors duration-300">
      
      {/* Background overlay images / patterns */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.04] bg-repeat bg-center"
        style={{ backgroundImage: "url('/wood-bg.png')", zIndex: 1 }}
      />
      <div className="fixed inset-0 pointer-events-none bg-gradient-to-b from-neutral-950 via-neutral-950 to-neutral-900" style={{ zIndex: 0 }} />

      {/* Top Banner Accent */}
      <div 
        className="h-1.5 w-full sticky top-0 z-50"
        style={{ backgroundImage: "linear-gradient(to right, #2563eb, #10b981, #f59e0b, #ec4899)" }}
      />

      {/* Toast popup */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl text-xs font-mono font-bold uppercase tracking-wider shadow-2xl flex items-center gap-2 border ${
              toast.type === "success" 
                ? "bg-neutral-900 border-emerald-500/30 text-emerald-400" 
                : "bg-neutral-900 border-rose-500/30 text-rose-450"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Container */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 py-8">
        
        {/* Site Header */}
        <header className="flex flex-col md:flex-row justify-between items-center gap-6 border-b border-neutral-850 pb-8 mb-8">
          <div className="flex flex-col items-center md:items-start text-center md:text-left">
            <h1 className="font-sans font-black text-4xl md:text-5xl uppercase tracking-tighter text-white flex items-center gap-3">
              <span className="bg-gradient-to-r from-blue-500 via-[#ccff00] to-emerald-400 bg-clip-text text-transparent">
                enVicelopedia
              </span>
            </h1>
            <p className="text-xs font-mono tracking-widest text-neutral-400 mt-2 uppercase">
              The Chronological History & Technical Catalog of Vice Golf Balls
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2.5 bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-white rounded-xl transition-all cursor-pointer"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sparkles className="w-4 h-4 text-amber-400" /> : <Layers className="w-4 h-4 text-blue-400" />}
            </button>

            {/* Firebase login status / auth action */}
            {currentUser ? (
              <div className="flex items-center gap-3 bg-neutral-900/60 border border-neutral-800 pl-3 pr-2 py-1.5 rounded-xl">
                <div className="flex flex-col text-right">
                  <span className="text-[10px] text-white font-bold max-w-[120px] truncate leading-tight">
                    {currentUser.displayName || currentUser.email}
                  </span>
                  <span className="text-[8px] font-mono uppercase text-neutral-500 leading-none mt-0.5">
                    {userRole}
                  </span>
                </div>
                <button 
                  onClick={() => signOut(auth).then(() => showToast("Logged out successfully"))}
                  className="p-1 text-neutral-400 hover:text-rose-500 hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
                  title="Sign Out"
                >
                  <Lock className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setAuthModalOpen(true)}
                className="py-2 px-4 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-xs font-mono font-bold text-neutral-300 hover:text-white uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Admin Sign In
              </button>
            )}
          </div>
        </header>

        {/* Tab Navigation */}
        <nav className="flex flex-wrap gap-2 mb-8 bg-neutral-900/40 p-1.5 rounded-2xl border border-neutral-850/60">
          {[
            { id: "timeline", label: "Timeline & History", icon: Calendar },
            { id: "models", label: "Core Models", icon: Layers },
            { id: "catalog", label: "Explore Catalog", icon: Compass },
            { id: "finder", label: "Ball Finder", icon: HelpCircle },
            { id: "admin", label: "Admin Portal", icon: Settings }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setEditingItem(null);
                }}
                className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl text-xs font-mono uppercase tracking-wider font-extrabold flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
                  active 
                    ? "bg-[#2563eb] text-neutral-950 font-black shadow-md shadow-[#2563eb]/20" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-900/60"
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-neutral-950' : 'text-neutral-500'}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Content Body */}
        <main className="min-h-[400px]">
          <AnimatePresence mode="wait">
            
            {/* 1. TIMELINE & HISTORY VIEW */}
            {activeTab === "timeline" && (
              <motion.div
                key="timeline"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-12"
              >
                <div className="text-center max-w-xl mx-auto space-y-3 mb-10">
                  <h2 className="text-2xl font-black uppercase text-white tracking-wide">
                    Vice Golf Evolution Timeline
                  </h2>
                  <p className="text-xs text-neutral-400 leading-relaxed font-mono">
                    A chronological archive tracking the design iterations, product launches, and technological strides of Vice Golf since its inception in Munich, Germany.
                  </p>
                </div>

                {isLoadingCatalog ? (
                  <div className="py-20 text-center font-mono text-xs text-neutral-500 animate-pulse">
                    Retrieving catalog timeline archives...
                  </div>
                ) : (
                  <div className="relative border-l border-neutral-800 ml-4 md:ml-32 space-y-12 pb-8">
                    {timelineData.map((group, groupIdx) => (
                      <div key={group.year} className="relative group">
                        
                        {/* Chronological Year Tag */}
                        <div className="absolute -left-4 md:-left-36 top-1 text-center w-24 hidden md:block">
                          <span className="text-base font-black font-sans bg-neutral-900 border border-neutral-800 px-3 py-1 rounded-lg text-[#2563eb] inline-block shadow-sm">
                            {group.year}
                          </span>
                        </div>

                        {/* Mobile Year Badge */}
                        <div className="md:hidden mb-2">
                          <span className="text-xs font-black bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded text-[#2563eb]">
                            {group.year}
                          </span>
                        </div>

                        {/* Node Marker */}
                        <div className="absolute -left-1.5 top-2 w-3 h-3 rounded-full bg-[#2563eb] ring-4 ring-neutral-950" />

                        {/* Releases in this year */}
                        <div className="pl-6 space-y-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {group.items.map(item => (
                              <div 
                                key={item.id}
                                className="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-5 hover:border-neutral-700 transition-all flex gap-4"
                              >
                                <div className="flex-shrink-0 flex items-center justify-center p-1 bg-neutral-950 rounded-xl border border-neutral-800 h-16 w-16">
                                  <BallVisual 
                                    color={item.color} 
                                    model={item.model} 
                                    size="md" 
                                    customImage={item.customImage}
                                    customImageSleeve={item.customImageSleeve}
                                    customImageBox={item.customImageBox}
                                    packageType="box"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="text-[9px] font-mono uppercase text-neutral-500 font-bold bg-neutral-950 px-1.5 py-0.5 rounded">
                                    {item.model}
                                  </span>
                                  <h4 className="text-sm font-sans font-black text-white uppercase mt-1">
                                    {item.name ? `${item.model} "${item.name}"` : `${item.model} Classic`}
                                  </h4>
                                  <p className="text-[10px] text-neutral-400 font-mono italic mt-1 leading-normal">
                                    {item.variation || item.notes || "Standard brand release configuration."}
                                  </p>
                                  <p className="text-[10px] text-[#2563eb] font-mono mt-1 font-bold">
                                    Colorway: {item.color}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* 2. CORE MODELS SPECIFICATIONS VIEW */}
            {activeTab === "models" && (
              <motion.div
                key="models"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-10"
              >
                <div className="text-center max-w-xl mx-auto space-y-3">
                  <h2 className="text-2xl font-black uppercase text-white tracking-wide">
                    Vice Core Specification Matrix
                  </h2>
                  <p className="text-xs text-neutral-400 leading-relaxed font-mono">
                    Compare the build parameters, cover material formulations, and target player profiles of the 8 core models developed by Vice Golf.
                  </p>
                </div>

                {/* Model Specification Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {Object.values(VICE_BALLS_SPECS).map(specs => (
                    <div 
                      key={specs.model}
                      className="bg-neutral-900/60 border border-neutral-800 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between"
                    >
                      <div>
                        {/* Model Title & Tagline */}
                        <div className="flex justify-between items-start border-b border-neutral-850 pb-4 mb-4">
                          <div>
                            <h3 className="font-sans font-black text-xl text-white uppercase leading-none">
                              {specs.model}
                            </h3>
                            <p className="text-[10px] font-mono text-[#2563eb] uppercase tracking-wide mt-1.5 font-bold">
                              {specs.tagline}
                            </p>
                          </div>
                          <span className="text-[10px] font-mono font-bold bg-neutral-950 px-2.5 py-1 border border-neutral-850 rounded-lg text-white">
                            ${specs.msrpPerDozen} / dz
                          </span>
                        </div>

                        {/* Specs Description */}
                        <p className="text-xs text-neutral-400 leading-relaxed font-sans mb-6">
                          {specs.description}
                        </p>

                        {/* Technical Parameters List */}
                        <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                          <div>
                            <span className="block text-[8px] uppercase font-mono tracking-wider text-neutral-500">
                              Cover Material
                            </span>
                            <span className="text-xs text-white font-bold font-sans">
                              {specs.cover}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[8px] uppercase font-mono tracking-wider text-neutral-500">
                              Feel Response
                            </span>
                            <span className="text-xs text-white font-bold font-sans">
                              {specs.feel}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[8px] uppercase font-mono tracking-wider text-neutral-500">
                              Structure Layers
                            </span>
                            <span className="text-xs text-white font-bold font-sans">
                              {specs.layers}-Piece Construction
                            </span>
                          </div>
                          <div>
                            <span className="block text-[8px] uppercase font-mono tracking-wider text-neutral-500">
                              Target Swing Speed
                            </span>
                            <span className="text-xs text-white font-bold font-sans">
                              {specs.targetSwingSpeed}
                            </span>
                          </div>
                        </div>

                        {/* Compression and Spin Progress Bars */}
                        <div className="space-y-4 mt-6 pt-6 border-t border-neutral-850">
                          <div>
                            <div className="flex justify-between items-center text-[10px] font-mono mb-1">
                              <span className="text-neutral-400">Core Compression Rating</span>
                              <span className="text-white font-bold">{specs.compression}</span>
                            </div>
                            <div className="h-1.5 bg-neutral-950 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-500 rounded-full" 
                                style={{ width: `${Math.min(100, (specs.compression / 120) * 100)}%` }} 
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Display Colors */}
                      <div className="mt-6 pt-4 border-t border-neutral-850 flex items-center justify-between gap-2">
                        <span className="text-[9px] uppercase font-mono tracking-wider text-neutral-500">
                          Primary Colorways
                        </span>
                        <div className="flex gap-1.5">
                          {specs.availableColors.map(color => {
                            const style = COLOR_STYLES[color] || { bg: "bg-neutral-800", ringColor: "ring-neutral-700" };
                            return (
                              <div 
                                key={color}
                                className={`w-3.5 h-3.5 rounded-full ring-2 ${style.bg} ${style.ringColor}`}
                                title={style.name || color}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* 3. EXPLORE CATALOG GRID */}
            {activeTab === "catalog" && (
              <motion.div
                key="catalog"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-8"
              >
                {/* Search & Filter Header */}
                <div className="bg-neutral-900/60 border border-neutral-800 p-5 rounded-2xl space-y-4">
                  <div className="flex flex-col md:flex-row gap-3">
                    
                    {/* Search Field */}
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
                      <input 
                        type="text"
                        placeholder="Search catalog by model, release name, colorway..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-850 focus:border-neutral-700 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white placeholder-neutral-500 outline-none transition-all"
                      />
                      {searchQuery && (
                        <button 
                          onClick={() => setSearchQuery("")}
                          className="absolute right-3 top-3 text-neutral-500 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Model Filter */}
                    <select
                      value={selectedModelFilter}
                      onChange={(e) => setSelectedModelFilter(e.target.value)}
                      className="bg-neutral-950 border border-neutral-850 hover:border-neutral-700 rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-neutral-300 outline-none cursor-pointer"
                    >
                      <option value="ALL">All Models</option>
                      {uniqueModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>

                    {/* Color Filter */}
                    <select
                      value={selectedColorFilter}
                      onChange={(e) => setSelectedColorFilter(e.target.value)}
                      className="bg-neutral-950 border border-neutral-850 hover:border-neutral-700 rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-neutral-300 outline-none cursor-pointer"
                    >
                      <option value="ALL">All Colors</option>
                      {uniqueColors.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>

                    {/* Year Filter */}
                    <select
                      value={selectedYearFilter}
                      onChange={(e) => setSelectedYearFilter(e.target.value)}
                      className="bg-neutral-950 border border-neutral-850 hover:border-neutral-700 rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-neutral-300 outline-none cursor-pointer"
                    >
                      <option value="ALL">All Years</option>
                      {uniqueYears.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>

                  </div>
                </div>

                {/* Catalog Grid */}
                {isLoadingCatalog ? (
                  <div className="py-20 text-center font-mono text-xs text-neutral-500 animate-pulse">
                    Scanning enVicelopedia indexes...
                  </div>
                ) : filteredCatalog.length === 0 ? (
                  <div className="py-20 text-center font-mono text-xs text-neutral-500 border border-dashed border-neutral-850 rounded-2xl">
                    No ball designs found matching the current search criteria.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {filteredCatalog.map(item => {
                      const specs = VICE_BALLS_SPECS[item.model as BallModel];
                      const isExpanded = expandedCardId === item.id;
                      return (
                        <div 
                          key={item.id}
                          className={`bg-neutral-900/60 border hover:bg-neutral-900 rounded-2xl p-4 transition-all duration-300 cursor-pointer ${
                            isExpanded ? 'border-blue-500/50 bg-neutral-900' : 'border-neutral-800'
                          }`}
                          onClick={() => setExpandedCardId(isExpanded ? null : item.id)}
                        >
                          <div className="flex gap-4">
                            <div className="flex-shrink-0 flex items-center justify-center p-1 bg-neutral-950 rounded-xl border border-neutral-800 h-16 w-16">
                              <BallVisual 
                                color={item.color} 
                                model={item.model} 
                                size="md" 
                                customImage={item.customImage}
                                customImageSleeve={item.customImageSleeve}
                                customImageBox={item.customImageBox}
                                packageType="box"
                              />
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                              <span className="text-[8px] font-mono font-bold bg-neutral-950 px-1.5 py-0.5 rounded text-neutral-400 self-start">
                                {item.year || "Classic"}
                              </span>
                              <h4 className="font-sans font-black text-white text-sm uppercase mt-1 truncate">
                                {item.name ? `${item.model} "${item.name}"` : `${item.model} Classic`}
                              </h4>
                              <p className="text-[10px] text-[#2563eb] font-mono mt-0.5 font-bold">
                                {item.color}
                              </p>
                            </div>
                            <div className="text-neutral-500 self-center">
                              <Info className="w-4 h-4" />
                            </div>
                          </div>

                          {/* Expanded Specifications Area */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden mt-4 pt-4 border-t border-neutral-800 space-y-4"
                                onClick={(e) => e.stopPropagation()} // prevent double toggling
                              >
                                {item.variation && (
                                  <div>
                                    <span className="block text-[8.5px] uppercase font-mono text-neutral-500">Design Background</span>
                                    <p className="text-xs text-neutral-300 font-sans mt-0.5 italic">"{item.variation}"</p>
                                  </div>
                                )}

                                {specs ? (
                                  <div className="grid grid-cols-2 gap-2 text-[10px] bg-neutral-950/60 p-2.5 rounded-lg border border-neutral-850 font-mono">
                                    <div>
                                      <span className="text-neutral-500">Layers:</span> <span className="text-white font-bold">{specs.layers}-Piece</span>
                                    </div>
                                    <div>
                                      <span className="text-neutral-500">Feel:</span> <span className="text-white font-bold">{specs.feel}</span>
                                    </div>
                                    <div>
                                      <span className="text-neutral-500">Compression:</span> <span className="text-white font-bold">{specs.compression}</span>
                                    </div>
                                    <div>
                                      <span className="text-neutral-500">Cover:</span> <span className="text-white font-bold truncate block max-w-full" title={specs.cover}>{specs.cover}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-neutral-500 italic">No standard technical specifications registered for this custom catalog item.</p>
                                )}

                                {isAdminEnabled && (
                                  <div className="flex gap-2 justify-end pt-2">
                                    <button 
                                      onClick={() => {
                                        setEditingItem(item);
                                        setActiveTab("admin");
                                      }}
                                      className="py-1 px-2.5 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 rounded-md text-[10px] font-mono text-neutral-300 flex items-center gap-1 cursor-pointer"
                                    >
                                      <Pencil className="w-3 h-3" /> Edit Specs
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteCatalogItem(item.id)}
                                      className="py-1 px-2.5 bg-rose-950 hover:bg-rose-900 border border-rose-900 rounded-md text-[10px] font-mono text-rose-300 flex items-center gap-1 cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" /> Remove
                                    </button>
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* 4. BALL FINDER QUIZ VIEW */}
            {activeTab === "finder" && (
              <motion.div
                key="finder"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="max-w-xl mx-auto space-y-8"
              >
                <div className="text-center space-y-3">
                  <h2 className="text-2xl font-black uppercase text-white tracking-wide">
                    Vice Ball Finder Tool
                  </h2>
                  <p className="text-xs text-neutral-400 leading-relaxed font-mono">
                    Answer three key questions about your game to find the ideal Vice golf ball model aligned with your technical specs.
                  </p>
                </div>

                <div className="bg-neutral-900/60 border border-neutral-800 p-6 rounded-3xl space-y-6">
                  {/* Q1: Distance / Swing Speed */}
                  <div className="space-y-2">
                    <label className="block text-xs uppercase font-mono text-neutral-300 font-bold">
                      1. What is your typical driver carry distance / swing speed?
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "long", label: "Long (> 250 yds)", speed: "> 110 mph" },
                        { id: "medium", label: "Medium (220-250 yds)", speed: "95-110 mph" },
                        { id: "short", label: "Short (< 220 yds)", speed: "< 95 mph" }
                      ].map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setQuizDistance(opt.id)}
                          className={`p-3 border text-center rounded-xl transition-all cursor-pointer ${
                            quizDistance === opt.id 
                              ? "bg-[#2563eb] border-[#2563eb] text-neutral-950 font-bold" 
                              : "bg-neutral-950 border-neutral-850 text-neutral-400 hover:border-neutral-700"
                          }`}
                        >
                          <span className="block text-xs font-bold">{opt.label}</span>
                          <span className="block text-[9px] opacity-75 font-mono mt-0.5">{opt.speed}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Q2: Priority */}
                  <div className="space-y-2">
                    <label className="block text-xs uppercase font-mono text-neutral-300 font-bold">
                      2. What is your primary priority on the course?
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "spin", label: "Green Control", detail: "High Wedge Spin" },
                        { id: "feel", label: "Soft Feel", detail: "Core Compression" },
                        { id: "straight", label: "Straight Flight", detail: "Minimize Slice" }
                      ].map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setQuizPriority(opt.id)}
                          className={`p-3 border text-center rounded-xl transition-all cursor-pointer ${
                            quizPriority === opt.id 
                              ? "bg-[#2563eb] border-[#2563eb] text-neutral-950 font-bold" 
                              : "bg-neutral-950 border-neutral-850 text-neutral-400 hover:border-neutral-700"
                          }`}
                        >
                          <span className="block text-xs font-bold">{opt.label}</span>
                          <span className="block text-[9px] opacity-75 font-mono mt-0.5">{opt.detail}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Q3: Cover finish */}
                  <div className="space-y-2">
                    <label className="block text-xs uppercase font-mono text-neutral-300 font-bold">
                      3. Do you have a cover finish style preference?
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "gloss", label: "Glossy White / Neon Colors" },
                        { id: "matte", label: "Premium Matte Cover Series" }
                      ].map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setQuizFinish(opt.id)}
                          className={`p-3 border text-center rounded-xl transition-all cursor-pointer ${
                            quizFinish === opt.id 
                              ? "bg-[#2563eb] border-[#2563eb] text-neutral-950 font-bold" 
                              : "bg-neutral-950 border-neutral-850 text-neutral-400 hover:border-neutral-700"
                          }`}
                        >
                          <span className="block text-xs font-bold">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={handleRunQuiz}
                    className="w-full py-3 bg-[#2563eb] text-neutral-950 font-black uppercase tracking-widest text-xs rounded-xl shadow-lg shadow-blue-950/20 active:scale-[0.99] transition-transform cursor-pointer"
                  >
                    Calculate Recommended Specs
                  </button>
                </div>

                {/* Result output */}
                {quizResult && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-neutral-900 border border-blue-500/30 p-6 rounded-3xl space-y-4"
                  >
                    <div className="flex items-center gap-2 text-[#2563eb]">
                      <Sparkles className="w-5 h-5 text-blue-400" />
                      <h3 className="font-sans font-black text-sm uppercase tracking-wider">
                        Recommendation: {quizResult.title}
                      </h3>
                    </div>

                    <p className="text-xs text-neutral-300 leading-relaxed font-sans">
                      {quizResult.reason}
                    </p>

                    <div className="grid grid-cols-2 gap-3 p-3 bg-neutral-950/60 rounded-2xl border border-neutral-850 font-mono text-[11px] text-neutral-400">
                      <div>
                        Compression: <span className="text-white font-bold">{quizResult.specs.compression}</span>
                      </div>
                      <div>
                        Feel: <span className="text-white font-bold">{quizResult.specs.feel}</span>
                      </div>
                      <div>
                        Layers: <span className="text-white font-bold">{quizResult.specs.layers}-Piece</span>
                      </div>
                      <div>
                        Cover: <span className="text-white font-bold">{quizResult.specs.cover}</span>
                      </div>
                      <div>
                        Speed: <span className="text-white font-bold">{quizResult.specs.swingSpeed}</span>
                      </div>
                      <div>
                        Distance: <span className="text-white font-bold">{quizResult.specs.driverDistance}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* 5. ADMIN PORTAL CONTROLS */}
            {activeTab === "admin" && (
              <motion.div
                key="admin"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="max-w-xl mx-auto space-y-8"
              >
                {!isAdminEnabled ? (
                  <div className="bg-neutral-900/60 border border-neutral-800 p-8 rounded-3xl text-center space-y-6">
                    <Lock className="w-12 h-12 text-[#2563eb] mx-auto opacity-75" />
                    <div className="space-y-2">
                      <h3 className="text-lg font-black uppercase text-white tracking-wide">
                        Database Access Restricted
                      </h3>
                      <p className="text-xs text-neutral-400 max-w-sm mx-auto leading-relaxed">
                        To add new releases, edit specifications, or modify the enVicelopedia database, please log in with your administrator credentials or verify local unlock controls.
                      </p>
                    </div>

                    <form onSubmit={handleGuestAdminLogin} className="flex gap-2 max-w-xs mx-auto pt-2">
                      <input 
                        type="password"
                        placeholder="Guest admin password..."
                        value={adminUnlockPassword}
                        onChange={(e) => setAdminUnlockPassword(e.target.value)}
                        className="flex-1 bg-neutral-950 border border-neutral-850 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-600 outline-none"
                      />
                      <button 
                        type="submit"
                        className="px-4 py-2 bg-[#2563eb] text-neutral-950 font-mono text-[11px] uppercase font-bold tracking-wider rounded-xl hover:bg-blue-500 cursor-pointer"
                      >
                        Unlock
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between bg-neutral-900 border border-neutral-800 px-5 py-3.5 rounded-2xl">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <Unlock className="w-4 h-4" />
                        <span className="text-xs font-mono font-bold uppercase tracking-wider">
                          Administrator Access Active
                        </span>
                      </div>
                      <button 
                        onClick={() => {
                          setIsGuestAdminUnlocked(false);
                          showToast("Database locked.");
                        }}
                        className="py-1 px-2.5 bg-neutral-950 border border-neutral-800 hover:bg-neutral-900 text-[9px] font-mono text-neutral-400 hover:text-white uppercase tracking-wider rounded-lg cursor-pointer"
                      >
                        Lock Portal
                      </button>
                    </div>

                    <AddMissingBallForm 
                      catalog={catalog}
                      onAddCatalogItem={handleAddCatalogItem}
                      onUpdateCatalogItem={handleUpdateCatalogItem}
                      editItem={editingItem}
                      onCancelEdit={() => setEditingItem(null)}
                    />
                  </div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </main>

        {/* Footer */}
        <footer className="mt-20 border-t border-neutral-850 pt-8 text-center space-y-2">
          <p className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest">
            enVicelopedia is an independent fan database celebrating the design legacy of Vice Golf.
          </p>
          <p className="text-[9px] font-mono text-neutral-700 leading-none">
            All brand assets, names, and images belong to their respective owners.
          </p>
        </footer>

      </div>

      {/* Auth Modal Overlay */}
      {authModalOpen && (
        <AuthModal 
          isOpen={authModalOpen} 
          onClose={() => setAuthModalOpen(false)} 
          onSuccess={() => {
            setAuthModalOpen(false);
            showToast("Successfully logged in!");
          }}
        />
      )}

    </div>
  );
}
