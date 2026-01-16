import React, { useState, useEffect } from 'react';

// Mock session data
const mockSessions = [
  {
    id: 1,
    worktree: 'feat/trace-view',
    path: '~/worktrees/trace',
    model: 'Opus 4.5',
    contextPercent: 42,
    status: 'active',
    summary: 'Implementing ECharts timeline visualization for distributed traces',
    lastActivity: '2m ago',
    tokensUsed: '85K',
    estimatedCost: '$4.20'
  },
  {
    id: 2,
    worktree: 'fix/auth-refresh',
    path: '~/worktrees/auth',
    model: 'Sonnet 4.5',
    contextPercent: 18,
    status: 'idle',
    summary: 'Token refresh logic complete - waiting for test results',
    lastActivity: '12m ago',
    tokensUsed: '23K',
    estimatedCost: '$0.85'
  },
  {
    id: 3,
    worktree: 'main',
    path: '~/projects/atrim',
    model: 'Opus 4.5',
    contextPercent: 67,
    status: 'working',
    summary: 'Code review PR #234 - reviewing storage layer changes',
    lastActivity: 'now',
    tokensUsed: '142K',
    estimatedCost: '$7.10'
  }
];

// Hammerspoon-style HUD (simpler, more utilitarian)
const HammerspoonPanel = () => {
  const [expanded, setExpanded] = useState(null);
  
  return (
    <div style={{
      width: 340,
      background: 'rgba(30, 30, 30, 0.95)',
      backdropFilter: 'blur(20px)',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.1)',
      fontFamily: 'SF Mono, Monaco, Menlo, monospace',
      fontSize: 11,
      color: '#e0e0e0',
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: 'rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.08)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚡</span>
          <span style={{ fontWeight: 600, letterSpacing: 0.5 }}>Claude Sessions</span>
        </div>
        <span style={{ color: '#666', fontSize: 10 }}>Hammerspoon</span>
      </div>
      
      {/* Sessions */}
      {mockSessions.map((session, idx) => (
        <div 
          key={session.id}
          onClick={() => setExpanded(expanded === idx ? null : idx)}
          style={{
            padding: '10px 12px',
            borderBottom: idx < mockSessions.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
            cursor: 'pointer',
            transition: 'background 0.15s',
            background: expanded === idx ? 'rgba(255,255,255,0.05)' : 'transparent'
          }}
        >
          {/* Main row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Status indicator */}
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: session.status === 'active' ? '#4ade80' : 
                         session.status === 'working' ? '#facc15' : '#6b7280',
              boxShadow: session.status === 'working' ? '0 0 8px #facc15' : 'none',
              animation: session.status === 'working' ? 'pulse 1.5s infinite' : 'none'
            }} />
            
            {/* Worktree name */}
            <span style={{ 
              color: '#4ecdc4', 
              fontWeight: 600,
              flex: 1
            }}>
              {session.worktree}
            </span>
            
            {/* Context bar */}
            <div style={{
              width: 60,
              height: 4,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 2,
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${session.contextPercent}%`,
                height: '100%',
                background: session.contextPercent > 60 ? '#f97316' : 
                           session.contextPercent > 40 ? '#facc15' : '#4ade80',
                borderRadius: 2
              }} />
            </div>
            <span style={{ color: '#888', fontSize: 10, width: 28 }}>
              {session.contextPercent}%
            </span>
          </div>
          
          {/* Summary */}
          <div style={{
            marginTop: 6,
            color: '#999',
            fontSize: 10,
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: expanded === idx ? 'normal' : 'nowrap'
          }}>
            {session.summary}
          </div>
          
          {/* Expanded details */}
          {expanded === idx && (
            <div style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px dashed rgba(255,255,255,0.1)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 4,
              fontSize: 10
            }}>
              <div><span style={{color:'#666'}}>Model:</span> {session.model}</div>
              <div><span style={{color:'#666'}}>Path:</span> {session.path}</div>
              <div><span style={{color:'#666'}}>Tokens:</span> {session.tokensUsed}</div>
              <div><span style={{color:'#666'}}>Cost:</span> {session.estimatedCost}</div>
            </div>
          )}
        </div>
      ))}
      
      {/* Footer */}
      <div style={{
        padding: '6px 12px',
        background: 'rgba(255,255,255,0.03)',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 10,
        color: '#666'
      }}>
        <span>⌘⇧C to toggle</span>
        <span>Click session to focus</span>
      </div>
    </div>
  );
};

// Native Swift-style Panel (more polished, macOS native feel)
const SwiftPanel = () => {
  const [hoveredSession, setHoveredSession] = useState(null);
  const [selectedSession, setSelectedSession] = useState(2);
  
  return (
    <div style={{
      width: 380,
      background: 'linear-gradient(180deg, rgba(50,50,55,0.98) 0%, rgba(35,35,40,0.98) 100%)',
      backdropFilter: 'blur(40px)',
      borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.12)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
      fontSize: 12,
      color: '#f0f0f0',
      overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.2) inset'
    }}>
      {/* Title bar with traffic lights */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.08)'
      }}>
        {/* Traffic lights */}
        <div style={{ display: 'flex', gap: 6, marginRight: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
        </div>
        
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ 
            fontSize: 18, 
            background: 'linear-gradient(135deg, #a78bfa 0%, #6366f1 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>◈</span>
          <span style={{ 
            fontWeight: 500, 
            fontSize: 13,
            letterSpacing: -0.3
          }}>Claude Session Monitor</span>
        </div>
        
        <div style={{
          padding: '3px 8px',
          background: 'rgba(99, 102, 241, 0.2)',
          borderRadius: 6,
          fontSize: 10,
          color: '#a5b4fc',
          fontWeight: 500
        }}>
          3 active
        </div>
      </div>
      
      {/* Sessions */}
      <div style={{ padding: '8px 10px' }}>
        {mockSessions.map((session, idx) => (
          <div 
            key={session.id}
            onMouseEnter={() => setHoveredSession(idx)}
            onMouseLeave={() => setHoveredSession(null)}
            onClick={() => setSelectedSession(idx)}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              marginBottom: idx < mockSessions.length - 1 ? 6 : 0,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: selectedSession === idx 
                ? 'linear-gradient(135deg, rgba(99,102,241,0.25) 0%, rgba(139,92,246,0.15) 100%)'
                : hoveredSession === idx 
                  ? 'rgba(255,255,255,0.06)'
                  : 'rgba(255,255,255,0.02)',
              border: selectedSession === idx 
                ? '1px solid rgba(99,102,241,0.4)'
                : '1px solid transparent',
              transform: hoveredSession === idx ? 'scale(1.01)' : 'scale(1)'
            }}
          >
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Status with animation */}
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: session.status === 'active' ? '#34d399' : 
                           session.status === 'working' ? '#fbbf24' : '#6b7280',
                boxShadow: session.status === 'working' 
                  ? '0 0 12px rgba(251,191,36,0.6)' 
                  : session.status === 'active'
                    ? '0 0 8px rgba(52,211,153,0.4)'
                    : 'none'
              }}>
                {session.status === 'working' && (
                  <div style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    background: '#fbbf24',
                    animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite'
                  }} />
                )}
              </div>
              
              {/* Worktree */}
              <div style={{ flex: 1 }}>
                <div style={{ 
                  fontWeight: 600, 
                  fontSize: 13,
                  color: '#f8fafc',
                  letterSpacing: -0.2
                }}>
                  {session.worktree}
                </div>
                <div style={{ 
                  fontSize: 10, 
                  color: '#64748b',
                  marginTop: 2
                }}>
                  {session.path}
                </div>
              </div>
              
              {/* Model badge */}
              <div style={{
                padding: '3px 8px',
                background: session.model.includes('Opus') 
                  ? 'rgba(251,146,60,0.2)' 
                  : 'rgba(96,165,250,0.2)',
                borderRadius: 6,
                fontSize: 9,
                fontWeight: 600,
                color: session.model.includes('Opus') ? '#fdba74' : '#93c5fd',
                letterSpacing: 0.3
              }}>
                {session.model.split(' ')[0]}
              </div>
            </div>
            
            {/* Context bar */}
            <div style={{ marginTop: 10 }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4
              }}>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>Context</span>
                <span style={{ 
                  fontSize: 10, 
                  color: session.contextPercent > 60 ? '#fb923c' : '#94a3b8',
                  fontWeight: session.contextPercent > 60 ? 600 : 400
                }}>
                  {session.contextPercent}%
                </span>
              </div>
              <div style={{
                height: 4,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 2,
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${session.contextPercent}%`,
                  height: '100%',
                  background: session.contextPercent > 60 
                    ? 'linear-gradient(90deg, #f97316, #fb923c)'
                    : session.contextPercent > 40 
                      ? 'linear-gradient(90deg, #eab308, #facc15)'
                      : 'linear-gradient(90deg, #22c55e, #4ade80)',
                  borderRadius: 2,
                  transition: 'width 0.5s ease'
                }} />
              </div>
            </div>
            
            {/* Summary */}
            <div style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 6,
              fontSize: 11,
              color: '#cbd5e1',
              lineHeight: 1.5,
              borderLeft: '2px solid rgba(99,102,241,0.5)'
            }}>
              {session.summary}
            </div>
            
            {/* Footer stats */}
            <div style={{
              marginTop: 8,
              display: 'flex',
              gap: 16,
              fontSize: 10,
              color: '#64748b'
            }}>
              <span>🕐 {session.lastActivity}</span>
              <span>📊 {session.tokensUsed}</span>
              <span>💰 {session.estimatedCost}</span>
            </div>
          </div>
        ))}
      </div>
      
      {/* Footer actions */}
      <div style={{
        padding: '10px 14px',
        background: 'rgba(0,0,0,0.2)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{
            padding: '5px 10px',
            background: 'rgba(99,102,241,0.2)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 6,
            color: '#a5b4fc',
            fontSize: 10,
            fontWeight: 500,
            cursor: 'pointer'
          }}>
            ↗ Focus
          </button>
          <button style={{
            padding: '5px 10px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            color: '#94a3b8',
            fontSize: 10,
            cursor: 'pointer'
          }}>
            🔄 Refresh
          </button>
        </div>
        <span style={{ fontSize: 9, color: '#475569' }}>
          Updated 3s ago
        </span>
      </div>
    </div>
  );
};

// Main comparison view
export default function ClaudeTrackerMockup() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
      padding: 40,
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 50 }}>
        <h1 style={{
          fontSize: 32,
          fontWeight: 700,
          color: '#f8fafc',
          marginBottom: 12,
          letterSpacing: -1
        }}>
          Claude Session Tracker Mockups
        </h1>
        <p style={{ 
          color: '#94a3b8', 
          fontSize: 16,
          maxWidth: 600,
          margin: '0 auto',
          lineHeight: 1.6
        }}>
          Two approaches for a floating always-on-top macOS panel to monitor 
          multiple Claude Code sessions across worktrees
        </p>
      </div>
      
      {/* Comparison */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 60,
        flexWrap: 'wrap'
      }}>
        {/* Hammerspoon */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            marginBottom: 16,
            padding: '6px 16px',
            background: 'rgba(74,222,128,0.1)',
            border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 20,
            display: 'inline-block'
          }}>
            <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 13 }}>
              Option A: Hammerspoon
            </span>
          </div>
          <HammerspoonPanel />
          <div style={{
            marginTop: 20,
            padding: 16,
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 8,
            maxWidth: 340,
            textAlign: 'left'
          }}>
            <h4 style={{ color: '#e2e8f0', marginBottom: 8, fontSize: 13 }}>Pros:</h4>
            <ul style={{ color: '#94a3b8', fontSize: 11, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>Quick to prototype (Lua scripting)</li>
              <li>You already have Hammerspoon experience</li>
              <li>WebView allows HTML/CSS flexibility</li>
              <li>Can be done in an afternoon</li>
            </ul>
            <h4 style={{ color: '#e2e8f0', marginTop: 12, marginBottom: 8, fontSize: 13 }}>Cons:</h4>
            <ul style={{ color: '#94a3b8', fontSize: 11, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>WebView can be memory-heavy</li>
              <li>Less native macOS feel</li>
              <li>Depends on Hammerspoon running</li>
            </ul>
          </div>
        </div>
        
        {/* Swift */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            marginBottom: 16,
            padding: '6px 16px',
            background: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 20,
            display: 'inline-block'
          }}>
            <span style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 13 }}>
              Option B: Native Swift
            </span>
          </div>
          <SwiftPanel />
          <div style={{
            marginTop: 20,
            padding: 16,
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 8,
            maxWidth: 380,
            textAlign: 'left'
          }}>
            <h4 style={{ color: '#e2e8f0', marginBottom: 8, fontSize: 13 }}>Pros:</h4>
            <ul style={{ color: '#94a3b8', fontSize: 11, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>True native macOS experience</li>
              <li>Lightweight, fast, low memory</li>
              <li>Can use NSWindow.level = .floating</li>
              <li>Standalone app (no dependencies)</li>
              <li>Can live in menubar with detachable panel</li>
            </ul>
            <h4 style={{ color: '#e2e8f0', marginTop: 12, marginBottom: 8, fontSize: 13 }}>Cons:</h4>
            <ul style={{ color: '#94a3b8', fontSize: 11, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>More development time (1-2 days)</li>
              <li>Requires Xcode and Swift knowledge</li>
              <li>Need to sign/notarize for distribution</li>
            </ul>
          </div>
        </div>
      </div>
      
      {/* Architecture diagram */}
      <div style={{
        marginTop: 60,
        padding: 30,
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        maxWidth: 900,
        margin: '60px auto 0'
      }}>
        <h3 style={{ color: '#f8fafc', marginBottom: 20, textAlign: 'center' }}>
          Data Flow Architecture
        </h3>
        <pre style={{
          color: '#94a3b8',
          fontSize: 11,
          fontFamily: 'SF Mono, Monaco, monospace',
          lineHeight: 1.8,
          overflow: 'auto'
        }}>
{`┌─────────────────────────────────────────────────────────────────────────┐
│  ~/.claude/projects/                                                     │
│  ├── atrim-main-abc123/                                                  │
│  │   └── chat_*.jsonl  ← Raw session data                               │
│  ├── atrim-trace-view-def456/                                           │
│  │   └── chat_*.jsonl                                                   │
│  └── atrim-auth-fix-ghi789/                                             │
│      └── chat_*.jsonl                                                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Session Parser (runs every 30-60s)                                      │
│  ├── Detect active sessions                                              │
│  ├── Map session → worktree directory                                   │
│  ├── Extract last N messages                                            │
│  ├── Calculate context % from token counts                              │
│  └── Generate summary (AI or heuristic)                                 │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
          ┌──────────────────────┴──────────────────────┐
          ▼                                              ▼
┌─────────────────────────┐               ┌─────────────────────────────┐
│  Hammerspoon WebView    │               │  Swift App                   │
│  hs.webview.new()       │               │  NSWindow.level = .floating │
│  level: floating        │               │  MenuBarExtra + Popover     │
│  HTML/CSS rendering     │               │  SwiftUI views              │
└─────────────────────────┘               └─────────────────────────────┘`}
        </pre>
      </div>
      
      {/* Recommendation */}
      <div style={{
        marginTop: 40,
        padding: 24,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(139,92,246,0.05) 100%)',
        borderRadius: 12,
        border: '1px solid rgba(99,102,241,0.2)',
        maxWidth: 700,
        margin: '40px auto 0'
      }}>
        <h3 style={{ color: '#c4b5fd', marginBottom: 12, fontSize: 15 }}>
          💡 Recommendation
        </h3>
        <p style={{ color: '#e2e8f0', lineHeight: 1.7, fontSize: 13 }}>
          <strong>Start with Hammerspoon</strong> as a quick prototype to validate the concept, 
          then if you use it daily, graduate to a <strong>native Swift menubar app</strong> for 
          the best experience. The Swift approach also opens possibilities like:
        </p>
        <ul style={{ color: '#cbd5e1', marginTop: 12, paddingLeft: 20, lineHeight: 1.8, fontSize: 12 }}>
          <li>Click session → auto-focus that terminal/VSCode window</li>
          <li>Menubar icon shows aggregate status (🟢 all good, 🟡 high context, 🔴 issues)</li>
          <li>Notifications when context hits 80%+</li>
          <li>Integration with your existing claude-session-agent</li>
        </ul>
      </div>
      
      {/* CSS for animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
