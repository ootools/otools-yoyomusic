export function SegmentedControl({ tabs, value, onChange }: { tabs: string[]; value: number; onChange: (index: number) => void }) {
  return <div className="segmented" role="tablist"><span className="segmented-pill" style={{ width: `calc((100% - 4px) / ${tabs.length})`, left: `calc(2px + (100% - 4px) * ${value} / ${tabs.length})` }} />
    {tabs.map((label, index) => <button key={label} type="button" role="tab" aria-selected={value === index} onClick={() => onChange(index)}>{label}</button>)}
  </div>;
}
