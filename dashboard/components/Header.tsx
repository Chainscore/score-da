import { Database, Menu, Github } from "lucide-react";

export default function Header() {
  return (
    <header className="border-b border-white/5 bg-[#0a0e1a]/90 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Brand */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-[#3DD9B3] to-[#7B2BF9] blur-lg opacity-40 group-hover:opacity-60 transition-opacity rounded-xl"></div>
              <div className="relative bg-gradient-to-br from-[#3DD9B3] to-[#2bb896] p-2.5 rounded-xl">
                <Database className="w-5 h-5 text-[#0a0e1a]" strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-2xl font-bold gradient-text tracking-tight">
                  DAx
                </h1>
                <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">v1.0</span>
              </div>
              <p className="text-[11px] text-gray-500 -mt-0.5">by Chainscore Labs</p>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#overview" className="text-sm font-medium text-gray-400 hover:text-[#3DD9B3] transition-colors relative group">
              Overview
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-[#3DD9B3] group-hover:w-full transition-all"></span>
            </a>
            <a href="#metrics" className="text-sm font-medium text-gray-400 hover:text-[#3DD9B3] transition-colors relative group">
              Metrics
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-[#3DD9B3] group-hover:w-full transition-all"></span>
            </a>
            <a href="#protocols" className="text-sm font-medium text-gray-400 hover:text-[#3DD9B3] transition-colors relative group">
              Protocols
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-[#3DD9B3] group-hover:w-full transition-all"></span>
            </a>
            <a 
              href="https://chainscore.finance" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-5 py-2 bg-gradient-to-r from-[#3DD9B3] to-[#2bb896] text-[#0a0e1a] rounded-xl font-semibold hover:shadow-lg hover:shadow-[#3DD9B3]/20 transition-all hover:scale-105"
            >
              Visit Chainscore
            </a>
          </nav>

          {/* Mobile menu button */}
          <button className="md:hidden p-2 text-gray-400 hover:text-[#3DD9B3] transition-colors">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
