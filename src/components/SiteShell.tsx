import { Link } from "react-router-dom";

export const REPO_URL = "https://github.com/ataztech910/promptfarm";
export const CHANGELOG_URL = "https://github.com/ataztech910/promptfarm/commits/master";

export const Container = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`container ${className}`}>{children}</div>
);

export const BrandMark = ({ className = "" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 128 128"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="pfMinimalNav" x1="18" y1="18" x2="106" y2="108" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#B7F37A" />
        <stop offset="100%" stopColor="#2ED3A8" />
      </linearGradient>
    </defs>
    <rect x="18" y="20" width="18" height="18" rx="4" fill="url(#pfMinimalNav)" />
    <circle cx="28" cy="78" r="10" fill="url(#pfMinimalNav)" />
    <rect x="46" y="48" width="18" height="18" rx="4" fill="url(#pfMinimalNav)" />
    <path d="M36 29 H58 V48" stroke="url(#pfMinimalNav)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M28 68 V57 H46" stroke="url(#pfMinimalNav)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M64 57 H82" stroke="url(#pfMinimalNav)" strokeWidth="6" strokeLinecap="round" />
    <path d="M76 50 L88 57 L76 64" fill="none" stroke="url(#pfMinimalNav)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    <g transform="translate(82 34)">
      <path d="M0 10 L14 3 L28 10 L14 17 Z" fill="url(#pfMinimalNav)" />
      <path d="M0 22 L14 15 L28 22 L14 29 Z" fill="url(#pfMinimalNav)" opacity="0.78" />
      <path d="M0 34 L14 27 L28 34 L14 41 Z" fill="url(#pfMinimalNav)" opacity="0.58" />
    </g>
  </svg>
);

export const SiteHeader = () => (
  <nav className="fixed top-0 w-full z-50 border-b border-border bg-background/80 backdrop-blur-md">
    <Container className="h-16 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-3 font-bold text-xl tracking-display leading-none">
        <BrandMark className="h-8 w-8 shrink-0 mt-1" />
        <span className="ml-[-10px]">
          <span className="text-foreground">Prompt</span>
          <span className="text-primary">Farm</span>
        </span>
      </Link>
      <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
        {/* <Link to="/docs" className="hover:text-foreground transition-colors">Documentation</Link> */}
        <Link to="/changelog" className="hover:text-foreground transition-colors">Changelog</Link>
        <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
      </div>
    </Container>
  </nav>
);

export const SiteFooter = () => (
  <footer className="py-12 border-t border-border">
    <Container className="flex flex-col md:flex-row justify-between items-center gap-6">
      <div className="text-text-tertiary text-xs font-mono-app">
        © 2026 PromptFarm. Built for the agentic era.
      </div>
      <div className="flex gap-6 text-text-tertiary text-xs font-mono-app">
        <Link to="/changelog" className="hover:text-foreground transition-colors">Changelog</Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">GitHub</a>
        <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
      </div>
    </Container>
  </footer>
);
