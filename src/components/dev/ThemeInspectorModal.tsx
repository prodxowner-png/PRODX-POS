import React, { useState, useEffect, useMemo } from 'react';
import {
  Palette,
  Search,
  Copy,
  Check,
  RefreshCw,
  Sliders,
  X,
  Code,
  Layers,
  Sparkles,
  Info,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface CssPropertyItem {
  name: string;
  value: string;
  computedValue: string;
  category: 'Colors' | 'Typography' | 'Radius & Spacing' | 'Shadows & Motion' | 'Prodx Tokens' | 'Other';
  isOverridden: boolean;
  overrideValue?: string;
}

interface ThemeInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ThemeInspectorModal: React.FC<ThemeInspectorModalProps> = ({ isOpen, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [properties, setProperties] = useState<CssPropertyItem[]>([]);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [isMaximized, setIsMaximized] = useState(false);

  // Extract and compute CSS Custom Properties from stylesheets & document element
  const scanCssProperties = () => {
    const propMap = new Map<string, { value: string; category: CssPropertyItem['category'] }>();

    // 1. Scan document.styleSheets
    try {
      for (let i = 0; i < document.styleSheets.length; i++) {
        const sheet = document.styleSheets[i];
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;
          for (let j = 0; j < rules.length; j++) {
            const rule = rules[j] as CSSStyleRule;
            if (rule && rule.style) {
              for (let k = 0; k < rule.style.length; k++) {
                const propName = rule.style[k];
                if (propName && propName.startsWith('--')) {
                  const val = rule.style.getPropertyValue(propName).trim();
                  let cat: CssPropertyItem['category'] = 'Other';
                  if (propName.includes('color') || propName.includes('bg') || propName.includes('card') || propName.includes('text') || propName.includes('border') || propName.includes('success') || propName.includes('warning') || propName.includes('danger') || propName.includes('chart') || propName.includes('primary')) {
                    cat = 'Colors';
                  } else if (propName.includes('font')) {
                    cat = 'Typography';
                  } else if (propName.includes('radius') || propName.includes('spacing') || propName.includes('gap') || propName.includes('padding')) {
                    cat = 'Radius & Spacing';
                  } else if (propName.includes('shadow') || propName.includes('motion') || propName.includes('transition')) {
                    cat = 'Shadows & Motion';
                  } else if (propName.includes('prodx')) {
                    cat = 'Prodx Tokens';
                  }
                  propMap.set(propName, { value: val, category: cat });
                }
              }
            }
          }
        } catch (e) {
          // Cross-origin stylesheets might throw security errors, safely ignore
        }
      }
    } catch (err) {
      console.warn('Error scanning stylesheets:', err);
    }

    // 2. Also fallback/add common root variables if computed
    const docStyle = getComputedStyle(document.documentElement);
    const standardProps = [
      '--primary-color', '--primary-dark', '--primary-light', '--primary-glow',
      '--bg-color', '--card-color', '--card-hover', '--text-color', '--text-muted',
      '--border-color', '--border-hover', '--button-radius', '--card-radius',
      '--success', '--success-light', '--warning', '--warning-light', '--danger', '--danger-light',
      '--chart-blue', '--chart-purple', '--chart-emerald',
      '--font-k2d', '--font-sans', '--font-mono',
      '--prodx-surface-0', '--prodx-surface-1', '--prodx-surface-2', '--prodx-surface-3',
      '--prodx-content', '--prodx-content-muted', '--prodx-line', '--prodx-line-strong',
      '--prodx-brand', '--prodx-brand-hover', '--prodx-radius-md', '--prodx-radius-lg',
      '--prodx-shadow-sm', '--prodx-shadow-md', '--prodx-shadow-lg', '--prodx-motion-base'
    ];

    standardProps.forEach((p) => {
      if (!propMap.has(p)) {
        let cat: CssPropertyItem['category'] = 'Colors';
        if (p.includes('font')) cat = 'Typography';
        else if (p.includes('radius') || p.includes('spacing')) cat = 'Radius & Spacing';
        else if (p.includes('shadow') || p.includes('motion')) cat = 'Shadows & Motion';
        else if (p.includes('prodx')) cat = 'Prodx Tokens';

        propMap.set(p, { value: docStyle.getPropertyValue(p).trim() || 'inherit', category: cat });
      }
    });

    const list: CssPropertyItem[] = [];
    propMap.forEach((info, name) => {
      const computedValue = docStyle.getPropertyValue(name).trim() || info.value;
      const isOverridden = name in overrides;
      list.push({
        name,
        value: info.value,
        computedValue: isOverridden ? overrides[name] : computedValue,
        category: info.category,
        isOverridden,
        overrideValue: overrides[name],
      });
    });

    list.sort((a, b) => a.name.localeCompare(b.name));
    setProperties(list);
  };

  useEffect(() => {
    if (isOpen) {
      scanCssProperties();
    }
  }, [isOpen, overrides]);

  // Handle live override change
  const handleOverrideChange = (name: string, val: string) => {
    const newOverrides = { ...overrides };
    if (!val.trim()) {
      delete newOverrides[name];
      document.documentElement.style.removeProperty(name);
    } else {
      newOverrides[name] = val;
      document.documentElement.style.setProperty(name, val);
    }
    setOverrides(newOverrides);
  };

  // Reset all overrides
  const handleResetOverrides = () => {
    Object.keys(overrides).forEach((name) => {
      document.documentElement.style.removeProperty(name);
    });
    setOverrides({});
    scanCssProperties();
  };

  const handleCopy = (name: string, val: string) => {
    navigator.clipboard.writeText(`var(${name}) /* ${val} */`);
    setCopiedName(name);
    setTimeout(() => setCopiedName(null), 2000);
  };

  const handleCopyAllCss = () => {
    const cssText = properties
      .map((p) => `  ${p.name}: ${p.computedValue};`)
      .join('\n');
    const fullSnippet = `:root {\n${cssText}\n}`;
    navigator.clipboard.writeText(fullSnippet);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const filteredProperties = useMemo(() => {
    return properties.filter((p) => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.computedValue.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [properties, searchTerm, selectedCategory]);

  if (!isOpen) return null;

  const categories = ['All', 'Colors', 'Prodx Tokens', 'Typography', 'Radius & Spacing', 'Shadows & Motion', 'Other'];

  const isColorValue = (val: string) => {
    return (
      val.startsWith('#') ||
      val.startsWith('rgb') ||
      val.startsWith('hsl') ||
      ['black', 'white', 'transparent', 'currentColor', 'inherit', 'initial'].includes(val.toLowerCase()) ||
      /^[a-zA-Z]+$/.test(val) && val.length < 15
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
      <div
        className={`bg-[#0F172A] border border-slate-700 text-slate-100 rounded-2xl shadow-2xl flex flex-col transition-all duration-300 ${
          isMaximized ? 'w-full h-full rounded-none' : 'w-full max-w-5xl h-[85vh]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 rounded-t-2xl">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Design System CSS Custom Properties Inspector
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Dev Tool
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Inspect active design tokens, live test overrides, and export theme configuration
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopyAllCss}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              title="Copy CSS :root block"
            >
              {copiedAll ? <Check className="w-4 h-4 text-emerald-400" /> : <Code className="w-4 h-4" />}
              {copiedAll ? 'Copied CSS!' : 'Copy :root CSS'}
            </button>

            {Object.keys(overrides).length > 0 && (
              <button
                onClick={handleResetOverrides}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition"
                title="Reset live overrides"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reset Overrides ({Object.keys(overrides).length})
              </button>
            )}

            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title={isMaximized ? 'Restore window' : 'Maximize window'}
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="px-6 py-3 border-b border-slate-800 bg-slate-900/30 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search custom property name or value (e.g., --primary-color, #3B82F6)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs bg-slate-950/60 border border-slate-700/80 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition ${
                  selectedCategory === cat
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Content Table / Grid */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 px-2">
            <span>Showing {filteredProperties.length} of {properties.length} CSS custom properties</span>
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              Tip: Edit value input to live-preview theme token changes instantly
            </span>
          </div>

          {filteredProperties.length === 0 ? (
            <div className="py-20 text-center flex flex-col items-center justify-center space-y-3">
              <Info className="w-10 h-10 text-slate-600" />
              <p className="text-sm font-medium text-slate-300">No CSS custom properties found matching your criteria.</p>
              <button
                onClick={() => { setSearchTerm(''); setSelectedCategory('All'); }}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredProperties.map((prop) => {
                const isColor = isColorValue(prop.computedValue) || isColorValue(prop.value);
                return (
                  <div
                    key={prop.name}
                    className={`p-3.5 rounded-xl border transition flex flex-col justify-between space-y-2 ${
                      prop.isOverridden
                        ? 'bg-amber-500/5 border-amber-500/40 shadow-sm shadow-amber-500/10'
                        : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono font-bold text-blue-300 truncate" title={prop.name}>
                            {prop.name}
                          </code>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            {prop.category}
                          </span>
                          {prop.isOverridden && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Overridden
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                          <span>Default: {prop.value}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleCopy(prop.name, prop.computedValue)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition shrink-0"
                        title="Copy variable reference"
                      >
                        {copiedName === prop.name ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Live Value & Override Input */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                      {isColor && (
                        <div
                          className="w-5 h-5 rounded-md border border-slate-600 shrink-0 shadow-inner"
                          style={{ backgroundColor: prop.computedValue }}
                          title={`Color swatch: ${prop.computedValue}`}
                        />
                      )}
                      <div className="flex-1 flex items-center gap-1 bg-slate-950/80 border border-slate-700/60 rounded-lg px-2.5 py-1">
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">Live:</span>
                        <input
                          type="text"
                          value={prop.isOverridden ? prop.overrideValue! : prop.computedValue}
                          onChange={(e) => handleOverrideChange(prop.name, e.target.value)}
                          placeholder={prop.value}
                          className="w-full text-xs font-mono bg-transparent text-slate-200 outline-none"
                          title="Click to live-edit this CSS property value"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/60 rounded-b-2xl flex items-center justify-between text-xs text-slate-400">
          <span>PRODX POS Theme & Design System Inspector</span>
          <div className="flex items-center gap-2">
            <button
              onClick={scanCssProperties}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Rescan Stylesheets
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition"
            >
              Close Inspector
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
