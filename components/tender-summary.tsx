import type { TranslationDictionary } from "@/lib/i18n";
import type { Tender } from "@/lib/types";

export function TenderSummary({ tender, t }: { tender: Tender; t: TranslationDictionary }) {
  return (
    <section className="panel border-l-4 border-l-cyan-900 p-4 sm:p-6" aria-labelledby="tender-title">
      <span className="inline-block max-w-full break-all rounded-md bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-900">{t.tenderId} · {tender.tender_id}</span>
      <h2 id="tender-title" className="mt-3 break-words text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{tender.title}</h2>
      <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
        {[[t.procuringEntity, tender.procuring_entity], [t.bidder, tender.bidder], [t.deadline, tender.submission_deadline]].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium text-slate-500">{label}</dt>
            <dd className={`mt-1.5 break-words font-semibold ${label === t.deadline ? "text-cyan-900" : "text-slate-800"}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
