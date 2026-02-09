import { ArrowRight, Zap, Brain, TrendingUp, Bell, BarChart3, Shield, Twitter, Github, Send, CheckCircle, Sparkles, Rocket, Eye, AlertTriangle, Lock, Gauge } from 'lucide-react';
import { useState, useEffect } from 'react';
import { WaitlistModal } from './WaitlistModal';
import { WalletConnectionModal } from './WalletConnectionModal';
import arctosLogo from '../../assets/images/arctos-logo.png.png';

interface HomepageProps {
  onGetStarted: () => void;
  theme: 'dark' | 'light';
}

export function Homepage({ onGetStarted, theme }: HomepageProps) {
  const isDark = theme === 'dark';
  const [waitlistModalOpen, setWaitlistModalOpen] = useState(false);
  const [hasJoinedWaitlist, setHasJoinedWaitlist] = useState(false);
  const [inlineEmail, setInlineEmail] = useState('');
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [inlineSuccess, setInlineSuccess] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  // Typing animation state for hero subheadline
  const fullSubheadline = 'Arctos transforms trading: real-time whale tracking, instant execution, fundamental news feeds, and smart trade management, all unified in one AI-powered platform.';
  const [typed, setTyped] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  // Check if user has already joined the waitlist
  useState(() => {
    const waitlist = JSON.parse(localStorage.getItem('arctos-waitlist') || '[]');
    setHasJoinedWaitlist(waitlist.length > 0);
  });

  const handleInlineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inlineEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inlineEmail)) {
      return;
    }

    setInlineSubmitting(true);

    // Simulate API call
    setTimeout(() => {
      const waitlist = JSON.parse(localStorage.getItem('arctos-waitlist') || '[]');
      waitlist.push({
        email: inlineEmail,
        timestamp: new Date().toISOString(),
        position: waitlist.length + 1
      });
      localStorage.setItem('arctos-waitlist', JSON.stringify(waitlist));
      
      setInlineSubmitting(false);
      setInlineSuccess(true);
      setInlineEmail('');
      
      setTimeout(() => setInlineSuccess(false), 5000);
    }, 1000);
  };

  // Typing effect: progressively reveal characters for hero subheadline
  useEffect(() => {
    let i = 0;
    setTyped('');
    setIsTyping(true);
    const speed = 45; // ms per character — slightly slower, natural
    const timer = setInterval(() => {
      i += 1;
      setTyped(fullSubheadline.slice(0, i));
      if (i >= fullSubheadline.length) {
        clearInterval(timer);
        setIsTyping(false);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [fullSubheadline]);

  const features = [
    {
      icon: Sparkles,
      title: 'AI-Powered Analysis',
      description: 'Get real-time market insights powered by advanced AI algorithms that analyze trends and patterns.',
      gradient: 'from-blue-500 to-cyan-500'
    },
    {
      icon: Rocket,
      title: 'Sniper Trading',
      description: 'Execute lightning-fast trades with our automated sniper bot. Never miss a profitable opportunity.',
      gradient: 'from-purple-500 to-pink-500'
    },
    {
      icon: Eye,
      title: 'Whale Tracking',
      description: 'Monitor large transactions in real-time and follow the smart money with whale alert notifications.',
      gradient: 'from-green-500 to-emerald-500'
    },
    {
      icon: Gauge,
      title: 'Advanced Terminal',
      description: 'Professional trading interface with real-time charts, order books, and one-click execution.',
      gradient: 'from-orange-500 to-red-500'
    },
    {
      icon: AlertTriangle,
      title: 'Smart Alerts',
      description: 'Stay informed with customizable alerts for price movements, whale activities, and market events.',
      gradient: 'from-yellow-500 to-amber-500'
    },
    {
      icon: Lock,
      title: 'Secure & Private',
      description: 'Your data and trades are protected with enterprise-grade security and encryption protocols.',
      gradient: 'from-indigo-500 to-blue-500'
    }
  ];

  const stats = [
    { value: '$2.5B+', label: 'Trading Volume' },
    { value: '50K+', label: 'Active Users' },
    { value: '99.9%', label: 'Uptime' },
    { value: '<100ms', label: 'Avg Execution' }
  ];

  return (
    <div className={`min-h-screen app-bg relative overflow-hidden`}>
      {/* Abstract Background Design */}
      {isDark && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* Gradient Orbs */}
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl"></div>
          
          {/* Grid Pattern */}
          <div 
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
              `,
              backgroundSize: '50px 50px'
            }}
          ></div>

          {/* Diagonal Lines */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="diagonal-lines" width="50" height="50" patternUnits="userSpaceOnUse">
                <line x1="0" y1="50" x2="50" y2="0" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#diagonal-lines)" />
          </svg>

          {/* Glowing Dots */}
          <div className="absolute top-1/3 left-1/4 w-2 h-2 bg-blue-400 rounded-full blur-sm opacity-30"></div>
          <div className="absolute top-2/3 right-1/3 w-2 h-2 bg-purple-400 rounded-full blur-sm opacity-30"></div>
          <div className="absolute bottom-1/3 left-2/3 w-2 h-2 bg-cyan-400 rounded-full blur-sm opacity-30"></div>
        </div>
      )}

      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 ${isDark ? 'bg-black/80 border-zinc-800' : 'bg-white/80 border-gray-200'} backdrop-blur-lg border-b`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={arctosLogo} alt="Arctos" className="w-12 h-12 object-contain drop-shadow-lg" />
            <span className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Arctos</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>
              Features
            </a>
            <a href="#about" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>
              About
            </a>
            <a href="#contact" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>
              Contact
            </a>
            <button
              onClick={() => setWaitlistModalOpen(true)}
              className="px-6 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors font-medium border border-zinc-700"
            >
              Sign In
            </button>
            <button
              onClick={() => setWalletModalOpen(true)}
              className="px-6 py-2 bg-gradient-to-r from-indigo-500 to-cyan-500 text-white rounded-lg hover:from-indigo-600 hover:to-cyan-600 transition-colors font-medium"
            >
              Connect Wallet
            </button>
            <button
              onClick={onGetStarted}
              className="px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-colors font-medium"
            >
              Launch App
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            {/* Coming Soon Badge */}
            <div className="mb-6 flex justify-center">
              <div className="px-6 py-2 rounded-full bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/30">
                <span className="text-sm font-semibold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  🚀 Coming Soon
                </span>
              </div>
            </div>

            {/* Logo */}
            <div className="mb-8 flex justify-center">
              <img src={arctosLogo} alt="Arctos" className="w-40 h-40 object-contain drop-shadow-2xl" />
            </div>

            {/* Main Headline */}
            <h1 className={`text-4xl md:text-6xl font-bold mb-6 leading-tight max-w-3xl mx-auto ${isDark ? 'text-white' : 'text-gray-900'}`}>
              DEX TRADING EVOLVED:{' '}
              <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                Where Blockchain Intelligence<br/>Meets AI Precision
              </span>
            </h1>

            {/* Sub-headline (typing animation) */}
            <p className={`text-lg md:text-xl mb-10 max-w-2xl mx-auto leading-relaxed ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
              <span className="typing-text">{typed}</span>
              {isTyping && <span className="typing-caret" aria-hidden="true"></span>}
            </p>

            {/* CTA Button */}
            <button
              onClick={onGetStarted}
              className="group px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all font-bold text-lg flex items-center gap-3 mx-auto shadow-lg shadow-blue-500/50"
            >
              Get Started
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>

            {/* Inline Email Form for Early Access */}
            <div className="mt-8">
              <p className={`text-sm mb-4 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                Or join our waitlist for early access
              </p>
              {inlineSuccess ? (
                <div className="flex items-center justify-center gap-2 text-green-500">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">You're on the waitlist! Check your email.</span>
                </div>
              ) : (
                <form onSubmit={handleInlineSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                  <input
                    type="email"
                    value={inlineEmail}
                    onChange={(e) => setInlineEmail(e.target.value)}
                    placeholder="Enter your email"
                    className={`flex-1 px-6 py-3 rounded-lg border ${
                      isDark 
                        ? 'bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500 focus:border-blue-500' 
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors`}
                    disabled={inlineSubmitting}
                  />
                  <button
                    type="submit"
                    disabled={inlineSubmitting}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {inlineSubmitting ? 'Joining...' : 'Join Waitlist'}
                  </button>
                </form>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-20">
              {stats.map((stat, index) => (
                <div key={index} className={`p-6 rounded-2xl ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-gray-50 border border-gray-200'}`}>
                  <div className={`text-3xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{stat.value}</div>
                  <div className={`${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className={`py-20 px-6 ${isDark ? 'bg-zinc-950' : 'bg-gray-50'} relative overflow-hidden`}>
        {/* Animated Background */}
        <div className="absolute inset-0 opacity-40">
          <div className="absolute top-20 left-10 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob opacity-20"></div>
          <div className="absolute top-40 right-10 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob opacity-20 animation-delay-2000"></div>
          <div className="absolute -bottom-8 left-1/2 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob opacity-20 animation-delay-4000"></div>
        </div>

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <h2 className={`text-4xl md:text-5xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Powerful Features
            </h2>
            <p className={`text-xl ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
              Everything you need to dominate the crypto market
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div
                  key={index}
                  className={`relative group p-8 rounded-2xl ${isDark ? 'bg-zinc-900/80 border border-zinc-800' : 'bg-white/80 border border-gray-200'} backdrop-blur-sm transition-all duration-500 hover:shadow-2xl hover:border-transparent`}
                  style={{
                    animation: `slideUp 0.6s ease-out ${index * 0.1}s both`
                  }}
                >
                  {/* Gradient Border Effect */}
                  <div className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-all duration-500 bg-gradient-to-r ${feature.gradient} -z-10 blur-xl`}></div>
                  
                  {/* Background Glow */}
                  <div className={`absolute inset-0 rounded-2xl ${isDark ? 'bg-zinc-900/80' : 'bg-white/80'} backdrop-blur-sm -z-10`}></div>

                  {/* Icon Container with Animation */}
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-6 group-hover:scale-125 group-hover:rotate-12 transition-all duration-500 shadow-lg`}>
                    <Icon className="w-8 h-8 text-white animate-pulse group-hover:animate-none" />
                  </div>

                  {/* Content */}
                  <h3 className={`text-xl font-bold mb-3 ${isDark ? 'text-white' : 'text-gray-900'} group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r ${feature.gradient} transition-all duration-300`}>
                    {feature.title}
                  </h3>
                  <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'} leading-relaxed group-hover:${isDark ? 'text-zinc-300' : 'text-gray-700'} transition-colors`}>
                    {feature.description}
                  </p>

                  {/* Hover Indicator */}
                  <div className={`mt-6 flex items-center gap-2 ${isDark ? 'text-cyan-400' : 'text-blue-600'} opacity-0 group-hover:opacity-100 transition-all duration-500 transform group-hover:translate-x-2`}>
                    <span className="text-sm font-semibold">Learn more</span>
                    <ArrowRight size={16} className="group-hover:animate-bounce" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className={`text-4xl md:text-5xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Built for Professional Traders
              </h2>
              <p className={`text-lg mb-6 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                Arctos combines cutting-edge artificial intelligence with blockchain technology to deliver the ultimate trading experience. Our platform is designed for traders who demand speed, accuracy, and reliability.
              </p>
              <p className={`text-lg mb-6 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                Whether you're a seasoned pro or just starting out, Arctos provides the tools and insights you need to make informed trading decisions and maximize your profits.
              </p>
              <button
                onClick={onGetStarted}
                className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Start Trading Now
              </button>
            </div>
            <div className={`p-8 rounded-2xl ${isDark ? 'bg-zinc-900' : 'bg-gray-100'}`}>
              <img src={arctosLogo} alt="Arctos Platform" className="w-full h-auto object-contain" />
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className={`py-20 px-6 ${isDark ? 'bg-zinc-950' : 'bg-gray-50'}`}>
        <div className="max-w-4xl mx-auto text-center">
          <h2 className={`text-4xl md:text-5xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Ready to Start Trading?
          </h2>
          <p className={`text-xl mb-10 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
            Join thousands of traders who are already winning with Arctos
          </p>
          <button
            onClick={onGetStarted}
            className="group px-10 py-5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all font-bold text-xl flex items-center gap-3 mx-auto shadow-lg shadow-blue-500/50"
          >
            Get Started Free
            <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className={`py-12 px-6 ${isDark ? 'bg-black border-t border-zinc-800' : 'bg-white border-t border-gray-200'}`}>
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            {/* Brand */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">A</div>
                <span className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Arctos</span>
              </div>
              <p className={`mb-6 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                The next generation DEX trading platform powered by AI and blockchain technology.
              </p>
              <div className="flex gap-4">
                <a
                  href="https://twitter.com/arctosapp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-10 h-10 rounded-lg ${isDark ? 'bg-zinc-900 hover:bg-zinc-800' : 'bg-gray-100 hover:bg-gray-200'} flex items-center justify-center transition-colors`}
                >
                  <Twitter className={`w-5 h-5 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`} />
                </a>
                <a
                  href="https://github.com/arctos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-10 h-10 rounded-lg ${isDark ? 'bg-zinc-900 hover:bg-zinc-800' : 'bg-gray-100 hover:bg-gray-200'} flex items-center justify-center transition-colors`}
                >
                  <Github className={`w-5 h-5 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`} />
                </a>
                <a
                  href="https://t.me/arctos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-10 h-10 rounded-lg ${isDark ? 'bg-zinc-900 hover:bg-zinc-800' : 'bg-gray-100 hover:bg-gray-200'} flex items-center justify-center transition-colors`}
                >
                  <Send className={`w-5 h-5 ${isDark ? 'text-zinc-400' : 'text-gray-600'}`} />
                </a>
              </div>
            </div>

            {/* Links */}
            <div>
              <h3 className={`font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Product</h3>
              <ul className="space-y-2">
                <li><a href="#features" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Features</a></li>
                <li><a href="#" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Pricing</a></li>
                <li><a href="#" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Roadmap</a></li>
                <li><a href="#" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Documentation</a></li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h3 className={`font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Company</h3>
              <ul className="space-y-2">
                <li><a href="#about" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>About</a></li>
                <li><a href="#" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Blog</a></li>
                <li><a href="#" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Careers</a></li>
                <li><a href="#contact" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Contact</a></li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className={`pt-8 border-t ${isDark ? 'border-zinc-800' : 'border-gray-200'} flex flex-col md:flex-row justify-between items-center gap-4`}>
            <p className={`${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
              © 2026 Arctos. All rights reserved.
            </p>
            <div className="flex gap-6">
              <a href="#" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Privacy Policy</a>
              <a href="#" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Terms of Service</a>
              <a href="#" className={`${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors`}>Cookie Policy</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Auth Modals */}
      <WaitlistModal isOpen={waitlistModalOpen} onClose={() => setWaitlistModalOpen(false)} theme={theme} />
      <WalletConnectionModal open={walletModalOpen} onOpenChange={setWalletModalOpen} />
    </div>
  );
}