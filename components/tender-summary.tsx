import type { TranslationDictionary } from "@/lib/i18n";
import type { Tender } from "@/lib/types";

export function TenderSummary({ tender, t }: { tender: Tender; t: TranslationDictionary }) {
  return (
    <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-5">
      <span className="text-xs font-semibold tracking-wide text-emerald-800">{t.tenderId} · {tender.tender_id}</span>
      <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">{tender.title}</h3>
      <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        {[[t.procuringEntity, tender.procuring_entity], [t.bidder, tender.bidder], [t.deadline, tender.submission_deadline]].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 break-words font-medium text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
