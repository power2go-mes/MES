import { useState, useMemo } from "react";
import logo from "@/imports/logo__2_.png";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

// ─── Mock data (replace with API calls to your MES backend) ──────────────────

const CELL_DATA = {
  all: [
    { status: "In Stock", count: 12_450 },
    { status: "Floor Stock", count: 5_200 },
    { status: "In Module", count: 3_100 },
    { status: "In Pack", count: 2_850 },
    { status: "In Rack", count: 900 },
    { status: "Sold", count: 400 },
    { status: "Scrap", count: 100 },
  ],
};

const MODULE_DATA = {
  "8S": [
    { status: "In Progress", count: 148 },
    { status: "In Pack", count: 286 },
    { status: "Sold", count: 1_840 },
    { status: "Scrap", count: 34 },
  ],
  "12S": [
    { status: "In Progress", count: 94 },
    { status: "In Pack", count: 211 },
    { status: "Sold", count: 1_240 },
    { status: "Scrap", count: 21 },
  ],
};

const PACK_DATA: Record<string, { status: string; count: number }[]> = {
  All: [
    { status: "In Stock", count: 58 },
    { status: "In Rack", count: 51 },
    { status: "Sold", count: 30 },
    { status: "Scrap", count: 4 },
  ],
  "5 kWh": [
    { status: "In Stock", count: 42 },
    { status: "In Rack", count: 32 },
    { status: "Sold", count: 12 },
    { status: "Scrap", count: 2 },
  ],
  "7.5 kWh": [
    { status: "In Stock", count: 16 },
    { status: "In Rack", count: 19 },
    { status: "Sold", count: 18 },
    { status: "Scrap", count: 2 },
  ],
};

const RACK_DATA: Record<string, { status: string; count: number }[]> = {
  All: [
    { status: "In Stock", count: 12 },
    { status: "Sold", count: 3 },
    { status: "Installed", count: 7 },
  ],
  "25 kWh": [
    { status: "In Stock", count: 7 },
    { status: "Sold", count: 1 },
    { status: "Installed", count: 4 },
  ],
  "75 kWh": [
    { status: "In Stock", count: 5 },
    { status: "Sold", count: 2 },
    { status: "Installed", count: 3 },
  ],
};

const STATUS_COLORS: Record<string, string> = {
  "In Stock": "#16a34a",
  "Floor Stock": "#2563eb",
  "In Module": "#7c3aed",
  "In Pack": "#d97706",
  "In Rack": "#0891b2",
  "Sold": "#059669",
  "Scrap": "#dc2626",
  "In Progress": "#2563eb",
  "QC Hold": "#d97706",
  "Passed QC": "#16a34a",
  "Rework": "#f97316",
  "Installed": "#7c3aed",
};

const FALLBACK_COLORS = ["#16a34a","#2563eb","#7c3aed","#d97706","#0891b2","#dc2626","#059669"];
const getColor = (status: string, i: number) =>
  STATUS_COLORS[status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];

// ─── Custom tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg bg-white border border-gray-200">
      {label && <p className="font-semibold text-gray-800 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-600">{p.name}:</span>
          <span className="font-semibold text-gray-900">{p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
};

const CustomLegend = ({ payload }: any) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-1">
    {payload?.map((entry: any, i: number) => (
      <div key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: entry.color }} />
        {entry.value}
      </div>
    ))}
  </div>
);

// ─── Filter tab ───────────────────────────────────────────────────────────────

function FilterTab({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150"
      style={{
        background: active ? "#16a34a" : "transparent",
        color: active ? "#fff" : "#6b7280",
        border: active ? "none" : "1px solid transparent",
      }}
    >
      {label}
    </button>
  );
}

// ─── Stat row item ────────────────────────────────────────────────────────────

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
        <span className="text-xs text-gray-600">{label}</span>
      </div>
      <span className="text-xs font-semibold text-gray-900 tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

// ─── Chart card ───────────────────────────────────────────────────────────────

function ChartCard({
  title, subtitle, total, icon, children, filters,
}: {
  title: string;
  subtitle: string;
  total: number;
  icon: React.ReactNode;
  children: React.ReactNode;
  filters: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#f0fdf4" }}>
            {icon}
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold text-gray-900 tabular-nums leading-tight">
            {total.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400">Total</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        {filters}
      </div>

      {/* Body */}
      <div className="flex-1 p-5">{children}</div>
    </div>
  );
}

// ─── 1. Cells ─────────────────────────────────────────────────────────────────

function CellsChart() {
  const statuses = CELL_DATA.all.map((d) => d.status);
  const [selected, setSelected] = useState("All");

  const data = useMemo(
    () => selected === "All" ? CELL_DATA.all : CELL_DATA.all.filter((d) => d.status === selected),
    [selected],
  );
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <ChartCard
      title="Cells"
      subtitle="Inventory status distribution"
      total={total}
      icon={
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="3" width="6" height="14" rx="1.5" fill="#16a34a" />
          <rect x="11" y="3" width="6" height="14" rx="1.5" fill="#86efac" />
          <rect x="8" y="6" width="4" height="2.5" rx="0.5" fill="#15803d" />
        </svg>
      }
      filters={
        <>
          <FilterTab label="All" active={selected === "All"} onClick={() => setSelected("All")} />
          {statuses.map((s) => (
            <FilterTab key={s} label={s} active={selected === s} onClick={() => setSelected(s)} />
          ))}
        </>
      }
    >
      <div className="flex gap-6">
        <div className="flex-shrink-0">
          <ResponsiveContainer width={180} height={180}>
            <PieChart>
              <Pie data={data} dataKey="count" nameKey="status" innerRadius={50} outerRadius={82} paddingAngle={2} strokeWidth={0}>
                {data.map((entry, i) => <Cell key={entry.status} fill={getColor(entry.status, i)} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 min-w-0 py-2">
          {(selected === "All" ? CELL_DATA.all : data).map((d, i) => (
            <StatRow key={d.status} label={d.status} value={d.count} color={getColor(d.status, i)} />
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

// ─── 2. Modules ───────────────────────────────────────────────────────────────

function ModulesChart() {
  const [config, setConfig] = useState<"Both" | "8S" | "12S">("Both");

  const data = useMemo(() => {
    const statuses = MODULE_DATA["8S"].map((d) => d.status);
    return statuses.map((status) => ({
      status,
      ...(config !== "12S" ? { "8S": MODULE_DATA["8S"].find((d) => d.status === status)!.count } : {}),
      ...(config !== "8S" ? { "12S": MODULE_DATA["12S"].find((d) => d.status === status)!.count } : {}),
    }));
  }, [config]);

  const total = useMemo(() => {
    if (config === "Both") return [...MODULE_DATA["8S"], ...MODULE_DATA["12S"]].reduce((s, d) => s + d.count, 0);
    return MODULE_DATA[config].reduce((s, d) => s + d.count, 0);
  }, [config]);

  return (
    <ChartCard
      title="Modules"
      subtitle="Production & status breakdown"
      total={total}
      icon={
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="5" width="16" height="10" rx="2" fill="#16a34a" />
          <rect x="5" y="8" width="10" height="4" rx="1" fill="#86efac" />
          <rect x="17" y="8" width="2" height="4" rx="1" fill="#15803d" />
          <rect x="1" y="8" width="2" height="4" rx="1" fill="#15803d" />
        </svg>
      }
      filters={
        <>
          {(["Both", "8S", "12S"] as const).map((v) => (
            <FilterTab key={v} label={v} active={config === v} onClick={() => setConfig(v)} />
          ))}
        </>
      }
    >
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barSize={14} barGap={3}>
          <CartesianGrid stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="status" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={44} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
          <Legend content={<CustomLegend />} />
          {(config === "Both" || config === "8S") && <Bar dataKey="8S" fill="#16a34a" radius={[3, 3, 0, 0]} />}
          {(config === "Both" || config === "12S") && <Bar dataKey="12S" fill="#86efac" radius={[3, 3, 0, 0]} />}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── 3. Battery Packs ─────────────────────────────────────────────────────────

function PacksChart() {
  const [model, setModel] = useState("All");
  const data = PACK_DATA[model] ?? PACK_DATA["All"];
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <ChartCard
      title="Battery Packs"
      subtitle="Status by model"
      total={total}
      icon={
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="4" width="14" height="12" rx="2" fill="#16a34a" />
          <rect x="5" y="8" width="8" height="4" rx="1" fill="#86efac" />
          <rect x="16" y="7" width="3" height="6" rx="1" fill="#15803d" />
        </svg>
      }
      filters={
        <>
          {["All", "5 kWh", "7.5 kWh"].map((m) => (
            <FilterTab key={m} label={m} active={model === m} onClick={() => setModel(m)} />
          ))}
        </>
      }
    >
      <div className="flex gap-6">
        <div className="flex-shrink-0">
          <ResponsiveContainer width={180} height={180}>
            <PieChart>
              <Pie data={data} dataKey="count" nameKey="status" innerRadius={50} outerRadius={82} paddingAngle={2} strokeWidth={0}>
                {data.map((entry, i) => <Cell key={entry.status} fill={getColor(entry.status, i)} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 min-w-0 py-2">
          {data.map((d, i) => (
            <StatRow key={d.status} label={d.status} value={d.count} color={getColor(d.status, i)} />
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

// ─── 4. Racks ────────────────────────────────────────────────────────────────

function RacksChart() {
  const [rackType, setRackType] = useState("All");
  const data = RACK_DATA[rackType] ?? RACK_DATA["All"];
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <ChartCard
      title="Racks"
      subtitle="Deployment & status overview"
      total={total}
      icon={
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="2" width="14" height="16" rx="2" fill="#16a34a" />
          <rect x="6" y="5" width="8" height="2" rx="0.5" fill="#86efac" />
          <rect x="6" y="9" width="8" height="2" rx="0.5" fill="#86efac" />
          <rect x="6" y="13" width="8" height="2" rx="0.5" fill="#86efac" />
          <circle cx="5" cy="6" r="0.8" fill="#fff" />
          <circle cx="5" cy="10" r="0.8" fill="#fff" />
          <circle cx="5" cy="14" r="0.8" fill="#fff" />
        </svg>
      }
      filters={
        <>
          {["All", "25 kWh", "75 kWh"].map((t) => (
            <FilterTab key={t} label={t} active={rackType === t} onClick={() => setRackType(t)} />
          ))}
        </>
      }
    >
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barSize={28}>
          <CartesianGrid stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="status" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={44} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
          <Bar dataKey="count" name="Racks" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => <Cell key={entry.status} fill={getColor(entry.status, i)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── KPI cards ────────────────────────────────────────────────────────────────

const KPI_LIST = [
  {
    label: "Capacity Produced",
    value: "375 kWh",
    delta: "+18.8%",
    positive: true,
    bg: "#f0fdf4",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z" fill="#16a34a" />
      </svg>
    ),
  },
  {
    label: "Batteries Produced",
    value: "59",
    delta: "+12.1%",
    positive: true,
    bg: "#eff6ff",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="7" width="18" height="10" rx="2.5" fill="#2563eb" />
        <rect x="5" y="10" width="11" height="4" rx="1" fill="#bfdbfe" />
        <rect x="20" y="10" width="3" height="4" rx="1" fill="#1d4ed8" />
      </svg>
    ),
  },
  {
    label: "Racks Produced",
    value: "4",
    delta: "+5.3%",
    positive: true,
    bg: "#fdf4ff",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="2" width="16" height="20" rx="2.5" fill="#7c3aed" />
        <rect x="7" y="6" width="10" height="2.5" rx="0.5" fill="#ddd6fe" />
        <rect x="7" y="11" width="10" height="2.5" rx="0.5" fill="#ddd6fe" />
        <rect x="7" y="16" width="10" height="2.5" rx="0.5" fill="#ddd6fe" />
      </svg>
    ),
  },
  {
    label: "Cells in Inventory",
    value: "12,450",
    delta: "-3.2%",
    positive: false,
    bg: "#fff7ed",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z" fill="#f97316" />
      </svg>
    ),
  },
  {
    label: "Quality Pass Rate",
    value: "98.2%",
    delta: "-0.8%",
    positive: false,
    bg: "#f0fdf4",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" fill="#16a34a" />
        <path d="M8 12.5L10.5 15L16 9.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Scrap Rate",
    value: "1.1%",
    delta: "+0.2%",
    positive: false,
    bg: "#fef2f2",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M3 6H21M8 6V4H16V6M19 6L18 20H6L5 6" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

function KpiCards() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {KPI_LIST.map((k) => (
        <div key={k.label} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: k.bg }}>
              {k.icon}
            </div>
            <span className="text-xs text-gray-500 font-medium leading-tight">{k.label}</span>
          </div>
          <div className="text-2xl font-extrabold text-gray-900 tabular-nums leading-none mb-1">
            {k.value}
          </div>
          <div className={`text-xs font-semibold ${k.positive ? "text-green-600" : "text-red-500"}`}>
            {k.delta} vs yesterday
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Date range tabs ──────────────────────────────────────────────────────────

function DateTabs() {
  const tabs = ["Today", "This Week", "This Month", "Custom Range"];
  const [active, setActive] = useState("Today");
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => setActive(t)}
          className="px-4 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{
            background: active === t ? "#16a34a" : "transparent",
            color: active === t ? "#fff" : "#6b7280",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header() {
  const now = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  return (
    <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
      <div className="max-w-screen-2xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center flex-shrink-0">
          <img src={logo} alt="Power2Go" className="h-8 w-auto object-contain" />
        </div>

        {/* Search */}
        <div className="flex-1 max-w-sm hidden md:block">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 20 20" fill="none">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
              <path d="M15 15L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search Cell / Module / Pack / Rack / Serial..."
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-700 placeholder-gray-400 focus:outline-none focus:border-green-400 bg-gray-50"
            />
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
              <rect x="3" y="4" width="14" height="13" rx="2" stroke="#9ca3af" strokeWidth="1.5" />
              <path d="M7 2V5M13 2V5" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M3 8H17" stroke="#9ca3af" strokeWidth="1.5" />
            </svg>
            {now}
          </div>
          <button
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
            style={{ background: "#16a34a" }}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
              <path d="M10 3V13M10 13L6.5 9.5M10 13L13.5 9.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 15H16" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page title bar ───────────────────────────────────────────────────────────

function TitleBar() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">CEO Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Real-time overview of production, inventory, sales and traceability</p>
      </div>
      <DateTabs />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div className="min-h-full bg-gray-50">
      <Header />
      <div className="max-w-screen-2xl mx-auto px-5 py-6 flex flex-col gap-6">
        <TitleBar />
        <KpiCards />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CellsChart />
          <ModulesChart />
          <PacksChart />
          <RacksChart />
        </div>
        <div className="text-center text-xs text-gray-400 pb-2">
          Power2Go MES · CEO Dashboard · Data refreshes automatically
        </div>
      </div>
    </div>
  );
}
