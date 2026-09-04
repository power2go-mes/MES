import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Factory,
  Flame,
  Layers,
  PackageCheck,
  QrCode,
  ScanLine,
  ShieldCheck,
  Truck,
} from 'lucide-react';

type FlowStage = {
  number: string;
  title: string;
  description: string;
  steps: string[];
  icon: React.ElementType;
  color: string;
  action: string;
  view: Parameters<ReturnType<typeof useApp>['setActiveView']>[0];
};

const stages: FlowStage[] = [
  {
    number: '01',
    title: 'Container to Floor',
    description: 'Receive supplier cells, register the pallet, scan it to floor stock, then allocate cells to a module.',
    steps: ['Supplier sheet', 'Pallet scan'],
    icon: Truck,
    color: 'blue',
    action: 'Open intake',
    view: 'container-floor',
  },
  {
    number: '02',
    title: 'Module Assembly',
    description: 'Select the module type, scan the required cells, test OCV/IR, grade, weld, and generate the module QR.',
    steps: ['Select type', 'Testing'],
    icon: Layers,
    color: 'emerald',
    action: 'Open module flow',
    view: 'workflow-module',
  },
  {
    number: '03',
    title: 'Pack Assembly',
    description: 'Combine verified modules, scan the controller, and run pack testing before releasing the pack.',
    steps: ['Scan modules', 'BMS / BMU'],
    icon: Boxes,
    color: 'violet',
    action: 'Open pack flow',
    view: 'workflow-pack',
  },
  {
    number: '04',
    title: 'Rack Assembly',
    description: 'Receive released packs, assign them to a rack, verify the rack, and record dispatch or sale.',
    steps: ['Select rack', 'Assign packs', 'Verify and QR'],
    icon: PackageCheck,
    color: 'cyan',
    action: 'Open rack flow',
    view: 'rack-assembly',
  },
];

const lifecycle = [
  { label: 'In stock', detail: 'Imported or released material is available.', icon: Factory, tone: 'blue' },
  { label: 'Floor stock', detail: 'Pallet is scanned and moved to the production floor.', icon: ScanLine, tone: 'cyan' },
  { label: 'In module', detail: 'Cell is assigned to a module slot.', icon: Layers, tone: 'emerald' },
  { label: 'In pack', detail: 'Verified modules are assembled into a pack.', icon: Boxes, tone: 'violet' },
  { label: 'In rack', detail: 'Released packs are assigned to a rack.', icon: PackageCheck, tone: 'amber' },
  { label: 'Sold', detail: 'The completed rack or pack is dispatched.', icon: Truck, tone: 'slate' },
];

export const ProductionFlowView: React.FC = () => {
  const { setActiveView } = useApp();

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm md:p-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">
                <ShieldCheck className="h-4 w-4" /> Smart battery production control
              </div>
              <h1 className="text-2xl font-black tracking-tight md:text-3xl">Production Flow</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">From container to floor, module, pack, and rack with one traceable handoff at every stage.</p>
            </div>
            <button type="button" onClick={() => setActiveView('dashboard')} className="flex items-center gap-2 self-start rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20 md:self-auto">
              <QrCode className="h-4 w-4" /> Open dashboard
            </button>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-4">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <article key={stage.number} className="relative flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {index < stages.length - 1 && <ArrowRight className="absolute -right-3 top-10 z-10 hidden h-6 w-6 rounded-full bg-slate-50 text-slate-400 xl:block" />}
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-3xl font-black text-slate-200">{stage.number}</span>
                  <span className={`rounded-xl bg-${stage.color}-50 p-3 text-${stage.color}-600`}><Icon className="h-5 w-5" /></span>
                </div>
                <h2 className="text-base font-black text-slate-900">{stage.title}</h2>
                <p className="mt-2 min-h-16 text-xs leading-5 text-slate-500">{stage.description}</p>
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  {stage.steps.map((step, stepIndex) => <div key={step} className="flex items-center gap-2 text-xs font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] text-slate-500">{stepIndex + 1}</span>{step}</div>)}
                </div>
                <button type="button" onClick={() => setActiveView(stage.view)} className="mt-5 flex items-center justify-between rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700">{stage.action}<ArrowRight className="h-4 w-4" /></button>
              </article>
            );
          })}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Lifecycle</p><h2 className="mt-1 text-lg font-black text-slate-900">Cell status from stock to sale</h2></div><button type="button" onClick={() => setActiveView('scrap')} className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"><Flame className="h-4 w-4" /> Scrap</button></div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {lifecycle.map((item, index) => { const Icon = item.icon; return <div key={item.label} className="relative rounded-xl border border-slate-200 p-4"><div className="mb-3 flex items-center justify-between"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">{index + 1}</span><Icon className="h-5 w-5 text-slate-500" /></div><h3 className="text-xs font-black uppercase tracking-wide text-slate-800">{item.label}</h3><p className="mt-1 text-[11px] leading-4 text-slate-500">{item.detail}</p></div>; })}
          </div>
          <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-red-700"><CheckCircle2 className="h-4 w-4" /> A damaged cell, module, pack, or rack is routed to scrap review and may be resolved as rework, release-approved, or scrap.</div>
        </section>
      </div>
    </div>
  );
};
