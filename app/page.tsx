"use client";

import { useEffect, useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

const HEX_SIZE = 28;
const SQRT3 = Math.sqrt(3);
const GRID_COLS = 17;
const GRID_ROWS = 14;
const BOARD_IDS = ["defense", "offense", "staging"] as const;

type BoardId = (typeof BOARD_IDS)[number];
type Role = "commander" | "officer" | "member";

type LegendItem = {
  id: string;
  label: string;
  color: string;
};

type Token = {
  id: string;
  q: number;
  r: number;
  type: string;
  label: string;
  locked?: boolean;
  callsign?: string;
  assignee?: string;
};

type Phase = {
  id: string;
  name: string;
  objective: string;
  time: string;
  boardId: BoardId;
};

type BoardState = {
  id: BoardId;
  name: string;
  legend: LegendItem[];
  tokens: Token[];
  notes: string;
};

type RoomState = {
  roomName: string;
  boards: Record<BoardId, BoardState>;
  phasePlan: Phase[];
  currentBoard: BoardId;
  currentPhaseId: string;
  updatedAt?: unknown;
};

const DEFAULT_LEGEND: LegendItem[] = [
  { id: "bait", label: "Bait Side", color: "#eab308" },
  { id: "strike", label: "Hidden Strike", color: "#dc2626" },
  { id: "walls", label: "Side Walls", color: "#2563eb" },
  { id: "reinforce", label: "Reinforce", color: "#22c55e" },
  { id: "reserve", label: "Reserve", color: "#a855f7" },
];

const DEFAULT_TOKENS: Token[] = [
  { id: "p1", q: 2, r: 10, type: "walls", label: "1", callsign: "Wall-1" },
  { id: "p2", q: 3, r: 9, type: "reinforce", label: "2", callsign: "R-2" },
  { id: "p3", q: 4, r: 8, type: "reinforce", label: "3", callsign: "R-3" },
  { id: "p4", q: 5, r: 7, type: "strike", label: "4", callsign: "Strike-4", locked: true },
  { id: "p5", q: 6, r: 6, type: "strike", label: "5", callsign: "Strike-5", locked: true },
  { id: "p6", q: 7, r: 5, type: "bait", label: "6", callsign: "Bait-6" },
];

const DEFAULT_ROOM: RoomState = {
  roomName: "Last Z War Room",
  currentBoard: "defense",
  currentPhaseId: "phase-1",
  boards: {
    defense: {
      id: "defense",
      name: "Defense Board",
      legend: DEFAULT_LEGEND,
      tokens: DEFAULT_TOKENS,
      notes: "Primary shield wall and trap entry lane.",
    },
    offense: {
      id: "offense",
      name: "Offense Board",
      legend: DEFAULT_LEGEND,
      tokens: DEFAULT_TOKENS.map((t, i) => ({
        ...t,
        id: `o${i}`,
        q: Math.max(0, t.q - 1),
        r: Math.max(0, t.r - 1),
      })),
      notes: "Assault stack and flanking path.",
    },
    staging: {
      id: "staging",
      name: "Staging Board",
      legend: DEFAULT_LEGEND,
      tokens: DEFAULT_TOKENS.map((t, i) => ({
        ...t,
        id: `s${i}`,
        q: Math.min(16, t.q + 2),
        r: t.r,
      })),
      notes: "Rally, reserve, and late reinforcement board.",
    },
  },
  phasePlan: [
    { id: "phase-1", name: "Phase 1", objective: "Set wall and bait lane", time: "T-10", boardId: "defense" },
    { id: "phase-2", name: "Phase 2", objective: "Trigger collapse", time: "T+00", boardId: "offense" },
    { id: "phase-3", name: "Phase 3", objective: "Rotate reserve to seal exits", time: "T+05", boardId: "staging" },
  ],
};

function axialToPixel(q: number, r: number, size = HEX_SIZE) {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

function pixelToAxial(x: number, y: number, size = HEX_SIZE) {
  const q = ((SQRT3 / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, -q - r, r);
}

function hexRound(q: number, s: number, r: number) {
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
  else if (rDiff > sDiff) rr = -rq - rs;

  return { q: rq, r: rr };
}

function hexPoints(cx: number, cy: number, size = HEX_SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

function buildCells() {
  const cells = [] as { q: number; r: number; x: number; y: number }[];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let q = 0; q < GRID_COLS; q++) {
      const { x, y } = axialToPixel(q, r);
      cells.push({ q, r, x, y });
    }
  }
  return cells;
}

const CELLS = buildCells();

const BOUNDS = (() => {
  const xs = CELLS.map((c) => c.x);
  const ys = CELLS.map((c) => c.y);
  return {
    minX: Math.min(...xs) - HEX_SIZE * 2,
    maxX: Math.max(...xs) + HEX_SIZE * 2,
    minY: Math.min(...ys) - HEX_SIZE * 2,
    maxY: Math.max(...ys) + HEX_SIZE * 2,
  };
})();

function cloneRoom(room: RoomState): RoomState {
  return JSON.parse(JSON.stringify(room));
}

function getFirebase() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const ready = Object.values(config).every(Boolean);
  if (!ready) return null;

  const app = getApps()[0] ?? initializeApp(config);
  return getFirestore(app);
}

export default function Page() {
  const [roomId, setRoomId] = useState("server-652");
  const [displayName, setDisplayName] = useState("Lulucabra");
  const [role, setRole] = useState<Role>("commander");
  const [liveMode, setLiveMode] = useState(true);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState>(cloneRoom(DEFAULT_ROOM));
  const [selectedType, setSelectedType] = useState(DEFAULT_LEGEND[0].id);
  const [selectedTokenId, setSelectedTokenId] = useState(DEFAULT_TOKENS[0].id);
  const [showCoords, setShowCoords] = useState(false);
  const [status, setStatus] = useState("Local mode");
  const [selectedTab, setSelectedTab] = useState<"boards" | "legend" | "roles" | "phases">("boards");

  const db = useMemo(() => getFirebase(), []);
  const board = room.boards[room.currentBoard];
  const selectedToken = board.tokens.find((t) => t.id === selectedTokenId) ?? null;
  const tokenMap = useMemo(() => new Map(board.tokens.map((t) => [`${t.q},${t.r}`, t])), [board.tokens]);
  const width = BOUNDS.maxX - BOUNDS.minX;
  const height = BOUNDS.maxY - BOUNDS.minY;

  useEffect(() => {
    const roomFromUrl = new URLSearchParams(window.location.search).get("room");
    if (roomFromUrl) setRoomId(roomFromUrl);
  }, []);

  useEffect(() => {
    if (!liveMode || !db || !roomId) {
      setConnected(false);
      setStatus(db ? "Local mode" : "Firebase not configured");
      return;
    }

    const ref = doc(db, "warRooms", roomId);
    const unsub = onSnapshot(ref, async (snap) => {
      if (snap.exists()) {
        setRoom(snap.data() as RoomState);
        setConnected(true);
        setStatus("Live sync active");
      } else {
        await setDoc(ref, { ...cloneRoom(DEFAULT_ROOM), updatedAt: serverTimestamp() });
        setConnected(true);
        setStatus("Room created");
      }
    });

    return () => unsub();
  }, [db, liveMode, roomId]);

  async function persist(next: RoomState) {
    setRoom(next);
    if (!liveMode || !db || !roomId) return;
    const ref = doc(db, "warRooms", roomId);
    await setDoc(ref, { ...next, updatedAt: serverTimestamp() });
  }

  function patchBoard(mutator: (draft: BoardState) => void) {
    const next = cloneRoom(room);
    mutator(next.boards[next.currentBoard]);
    void persist(next);
  }

  function patchRoom(mutator: (draft: RoomState) => void) {
    const next = cloneRoom(room);
    mutator(next);
    void persist(next);
  }

  function canMoveToken(token: Token) {
    if (role === "commander") return true;
    if (role === "officer") return !token.locked;
    return false;
  }

  function moveToken(tokenId: string, q: number, r: number) {
    patchBoard((draft) => {
      const token = draft.tokens.find((t) => t.id === tokenId);
      if (!token || !canMoveToken(token)) return;
      token.q = Math.max(0, Math.min(GRID_COLS - 1, q));
      token.r = Math.max(0, Math.min(GRID_ROWS - 1, r));
    });
  }

  function addToken() {
    patchBoard((draft) => {
      const id = `p-${Date.now()}`;
      draft.tokens.push({
        id,
        q: 0,
        r: 0,
        type: selectedType,
        label: String(draft.tokens.length + 1),
        callsign: `${selectedType}-${draft.tokens.length + 1}`,
      });
      setSelectedTokenId(id);
    });
  }

  function duplicateToken() {
    if (!selectedToken) return;
    patchBoard((draft) => {
      const id = `p-${Date.now()}`;
      draft.tokens.push({
        ...selectedToken,
        id,
        q: Math.min(GRID_COLS - 1, selectedToken.q + 1),
        label: `${selectedToken.label}*`,
      });
      setSelectedTokenId(id);
    });
  }

  function addLegend() {
    patchBoard((draft) => {
      const id = `g-${Date.now()}`;
      draft.legend.push({ id, label: "New Group", color: "#a855f7" });
      setSelectedType(id);
    });
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    void navigator.clipboard.writeText(url);
    setStatus("Share link copied");
  }

  function boardEventToHex(event: React.PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width + BOUNDS.minX;
    const y = ((event.clientY - rect.top) / rect.height) * height + BOUNDS.minY;
    const rounded = pixelToAxial(x, y);
    return {
      q: Math.max(0, Math.min(GRID_COLS - 1, rounded.q)),
      r: Math.max(0, Math.min(GRID_ROWS - 1, rounded.r)),
    };
  }

  return (
    <main className="page-shell">
      <div className="app-grid">
        <section className="panel">
          <div className="panel-title-row">
            <div>
              <h1>Last Z War Room</h1>
              <p className="muted">Deploy-ready multiplayer planner for your alliance.</p>
            </div>
            <div className="status-pills">
              <span className="pill">{connected ? "Connected" : "Offline"}</span>
              <span className="pill">{status}</span>
            </div>
          </div>

          <div className="field-group">
            <label>Room ID</label>
            <div className="row">
              <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
              <button onClick={copyLink}>Copy Link</button>
            </div>
            <div className="help-text">Anyone opening the same room link joins the same shared board.</div>
          </div>

          <div className="two-col">
            <div className="field-group">
              <label>Callsign</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="commander">Commander</option>
                <option value="officer">Officer</option>
                <option value="member">Member</option>
              </select>
            </div>
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-title">Live multiplayer</div>
              <div className="help-text">Uses Firebase Firestore for shared rooms.</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={liveMode} onChange={(e) => setLiveMode(e.target.checked)} />
              <span className="slider" />
            </label>
          </div>

          <div className="tab-row">
            {(["boards", "legend", "roles", "phases"] as const).map((tab) => (
              <button
                key={tab}
                className={selectedTab === tab ? "tab active" : "tab"}
                onClick={() => setSelectedTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {selectedTab === "boards" && (
            <div className="tab-panel">
              <div className="field-group">
                <label>Current board</label>
                <select
                  value={room.currentBoard}
                  onChange={(e) =>
                    patchRoom((draft) => {
                      draft.currentBoard = e.target.value as BoardId;
                    })
                  }
                >
                  {BOARD_IDS.map((id) => (
                    <option key={id} value={id}>
                      {room.boards[id].name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row">
                <button onClick={addToken}>Add Player</button>
                <button onClick={duplicateToken} className="secondary">
                  Copy
                </button>
              </div>

              <div className="field-group">
                <label>Board notes</label>
                <textarea
                  value={board.notes}
                  onChange={(e) =>
                    patchBoard((draft) => {
                      draft.notes = e.target.value;
                    })
                  }
                />
              </div>
            </div>
          )}

          {selectedTab === "legend" && (
            <div className="tab-panel">
              <button onClick={addLegend}>Add Legend Group</button>
              <div className="stack">
                {board.legend.map((item) => (
                  <div key={item.id} className={selectedType === item.id ? "card selected" : "card"}>
                    <button
                      className="color-dot"
                      style={{ backgroundColor: item.color }}
                      onClick={() => setSelectedType(item.id)}
                      aria-label={`Select ${item.label}`}
                    />
                    <input
                      value={item.label}
                      onChange={(e) =>
                        patchBoard((draft) => {
                          const found = draft.legend.find((x) => x.id === item.id);
                          if (found) found.label = e.target.value;
                        })
                      }
                    />
                    <input
                      type="color"
                      value={item.color}
                      onChange={(e) =>
                        patchBoard((draft) => {
                          const found = draft.legend.find((x) => x.id === item.id);
                          if (found) found.color = e.target.value;
                        })
                      }
                      className="color-input"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedTab === "roles" && (
            <div className="tab-panel">
              <div className="note-box">
                Commander: full control. Officer: can move unlocked tokens. Member: view only.
              </div>
              <div className="stack">
                {board.tokens.map((token) => (
                  <div
                    key={token.id}
                    className={selectedTokenId === token.id ? "role-card selected" : "role-card"}
                    onClick={() => setSelectedTokenId(token.id)}
                  >
                    <div>
                      <div className="role-name">Player {token.label}</div>
                      <div className="help-text">
                        {token.callsign || "No callsign"} • q:{token.q} r:{token.r}
                      </div>
                    </div>
                    <button
                      className={token.locked ? "" : "secondary"}
                      onClick={(e) => {
                        e.stopPropagation();
                        patchBoard((draft) => {
                          const found = draft.tokens.find((x) => x.id === token.id);
                          if (found && role === "commander") found.locked = !found.locked;
                        });
                      }}
                    >
                      {token.locked ? "Locked" : "Unlocked"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedTab === "phases" && (
            <div className="tab-panel stack">
              {room.phasePlan.map((phase) => (
                <button
                  key={phase.id}
                  className={room.currentPhaseId === phase.id ? "phase-card selected" : "phase-card"}
                  onClick={() =>
                    patchRoom((draft) => {
                      draft.currentPhaseId = phase.id;
                      draft.currentBoard = phase.boardId;
                    })
                  }
                >
                  <div className="phase-title">{phase.name}</div>
                  <div>{phase.objective}</div>
                  <div className="help-text">
                    {phase.time} • {room.boards[phase.boardId].name}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="board-panel">
          <div className="board-header">
            <div>
              <h2>{room.roomName}</h2>
              <div className="help-text">
                {board.name} • {room.phasePlan.find((p) => p.id === room.currentPhaseId)?.name} • {role}
              </div>
            </div>

            <div className="toolbar">
              {board.legend.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedType(item.id)}
                  className={selectedType === item.id ? "legend-pill selected" : "legend-pill"}
                  style={{ backgroundColor: item.color }}
                >
                  {item.label}
                </button>
              ))}
              <label className="coords-toggle">
                <input type="checkbox" checked={showCoords} onChange={(e) => setShowCoords(e.target.checked)} />
                <span>Coords</span>
              </label>
            </div>
          </div>

          <div className="battlefield">
            <svg
              viewBox={`${BOUNDS.minX} ${BOUNDS.minY} ${width} ${height}`}
              className="battlefield-svg"
              onPointerMove={(e) => {
                const dragging = selectedToken && canMoveToken(selectedToken) && (e.buttons & 1) === 1;
                if (!dragging) return;
                const next = boardEventToHex(e);
                moveToken(selectedToken.id, next.q, next.r);
              }}
            >
              {CELLS.map((cell) => {
                const occupied = tokenMap.get(`${cell.q},${cell.r}`);
                const fill = occupied
                  ? `${board.legend.find((x) => x.id === occupied.type)?.color ?? "#94a3b8"}25`
                  : "rgba(255,255,255,0.03)";
                return (
                  <g key={`${cell.q}-${cell.r}`}>
                    <polygon
                      points={hexPoints(cell.x, cell.y)}
                      fill={fill}
                      stroke="rgba(255,255,255,0.58)"
                      strokeWidth="1.05"
                      className="hex-cell"
                      onPointerDown={() => {
                        if (selectedToken) moveToken(selectedToken.id, cell.q, cell.r);
                      }}
                    />
                    {showCoords && (
                      <text
                        x={cell.x}
                        y={cell.y + 3}
                        textAnchor="middle"
                        fontSize="8"
                        fill="rgba(255,255,255,0.55)"
                      >
                        {cell.q},{cell.r}
                      </text>
                    )}
                  </g>
                );
              })}

              {board.tokens.map((token) => {
                const { x, y } = axialToPixel(token.q, token.r);
                const selected = token.id === selectedTokenId;
                const color = board.legend.find((l) => l.id === token.type)?.color ?? "#94a3b8";
                return (
                  <g
                    key={token.id}
                    onPointerDown={() => setSelectedTokenId(token.id)}
                    style={{ cursor: canMoveToken(token) ? "grab" : "not-allowed" }}
                  >
                    <polygon
                      points={hexPoints(x, y, HEX_SIZE - 2)}
                      fill={color}
                      fillOpacity={selected ? "0.94" : "0.74"}
                      stroke={selected ? "#ffffff" : "rgba(255,255,255,0.35)"}
                      strokeWidth={selected ? "2.5" : "1.2"}
                    />
                    <polygon
                      points={hexPoints(x, y + 2, HEX_SIZE - 8)}
                      fill="rgba(255,255,255,0.17)"
                      stroke="rgba(255,255,255,0.18)"
                      strokeWidth="0.7"
                    />
                    <text x={x} y={y + 4} textAnchor="middle" fontWeight="700" fontSize="12" fill="#fff">
                      {token.label}
                    </text>
                    {token.locked && (
                      <text x={x + 18} y={y - 14} textAnchor="middle" fontWeight="700" fontSize="12" fill="#fff">
                        🔒
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="summary-grid">
            <div className="summary-card">
              <div className="summary-label">Selected</div>
              <div className="summary-value">{selectedToken ? `Player ${selectedToken.label}` : "None"}</div>
              <div className="help-text">{selectedToken?.callsign ?? "Select a token"}</div>
            </div>

            <div className="summary-card">
              <div className="summary-label">Current objective</div>
              <div className="summary-value">
                {room.phasePlan.find((p) => p.id === room.currentPhaseId)?.objective ?? "No phase selected"}
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-label">Collaboration</div>
              <div className="summary-value">{liveMode ? "Shared live room" : "Single-user mode"}</div>
              <div className="help-text">Room: {roomId}</div>
            </div>
          </div>

          <div className="row actions">
            <button onClick={() => void persist(room)}>Save now</button>
            <button onClick={() => void persist(cloneRoom(DEFAULT_ROOM))} className="secondary">
              Reset room
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
