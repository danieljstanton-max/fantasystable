import Link from "next/link";
import { GOING_LABEL, GOING_STYLE, type GoingBand } from "@/lib/going";

/**
 * The going chip. Colour runs wet-to-dry across the turf scale so a page of
 * meetings can be read for ground without reading the labels. All-weather sits
 * off the scale in neutral slate, because Tapeta is not a point on the
 * turf axis and colouring it as though it were would be misleading.
 */
export function GoingChip({ band, detail }: { band: GoingBand; detail?: string | null }) {
  const style = GOING_STYLE[band];
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-[3px] text-[11px] font-semibold uppercase tracking-wide"
      style={{ background: style.bg, color: style.fg }}
      title={detail ?? GOING_LABEL[band]}
    >
      {detail ?? GOING_LABEL[band]}
    </span>
  );
}

/** Form string with wins picked out. "1-3241" */
export function FormString({ form }: { form?: string | null }) {
  if (!form) return <span className="text-muted">—</span>;
  return (
    <span className="form-fig" aria-label={`Recent form: ${form}`}>
      {form.split("").map((ch, i) =>
        ch === "1" ? (
          <span key={i} className="win">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </span>
  );
}

/** Time to the off. Server-rendered text, upgraded client-side by NextOffBoard. */
export function OffTime({ time, dt }: { time: string; dt: Date }) {
  return (
    <time dateTime={dt.toISOString()} className="num text-[17px] font-semibold leading-none">
      {time}
    </time>
  );
}

export type RunnerView = {
  horseId: string;
  horseName: string;
  number: number | null;
  draw: number | null;
  age: number | null;
  weight: string | null;
  jockeyName: string | null;
  trainerName: string | null;
  form: string | null;
  ofr: number | null;
  rpr: number | null;
  headgear: string | null;
  silkUrl: string | null;
  isNonRunner: boolean;
  comment: string | null;
};

export function RunnerRow({ runner: r }: { runner: RunnerView }) {
  if (r.isNonRunner) {
    return (
      <tr className="border-t border-rule text-muted">
        <td className="num px-2 py-2 align-top">{r.number ?? "—"}</td>
        <td className="px-2 py-2" colSpan={5}>
          <span className="line-through">{r.horseName}</span>
          <span className="ml-2 rounded-sm bg-[var(--rule)] px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-wide">
            Non-runner
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-rule align-top">
      <td className="num px-2 py-3 text-[13px] text-muted">
        {r.number ?? "—"}
        {r.draw !== null && <span className="ml-1 text-[11px]">({r.draw})</span>}
      </td>

      <td className="px-2 py-3">
        <div className="flex items-start gap-2">
          {r.silkUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={r.silkUrl} alt="" width={22} height={26} loading="lazy" className="mt-[2px]" />
          )}
          <div className="min-w-0">
            <Link
              href={`/horses/${r.horseId}`}
              className="font-display text-[19px] leading-tight hover:text-claret"
            >
              {r.horseName}
            </Link>
            {r.headgear && (
              <span className="ml-1.5 align-top text-[11px] font-semibold text-brass">
                {r.headgear}
              </span>
            )}
            <div className="mt-0.5 text-[12px] text-muted">
              {r.jockeyName} <span className="text-rule">·</span> {r.trainerName}
            </div>
            {r.comment && (
              <p className="mt-1.5 max-w-prose text-[13px] leading-snug text-muted">{r.comment}</p>
            )}
          </div>
        </div>
      </td>

      <td className="px-2 py-3 text-[13px]">
        <FormString form={r.form} />
      </td>
      <td className="num px-2 py-3 text-[13px]">
        {r.age ?? "—"} <span className="text-muted">{r.weight ?? ""}</span>
      </td>
      <td className="num px-2 py-3 text-[13px] text-muted">{r.ofr ?? "—"}</td>
      <td className="num px-2 py-3 text-[13px] text-muted">{r.rpr ?? "—"}</td>
    </tr>
  );
}

export function RunnerTable({ runners }: { runners: RunnerView[] }) {
  const declared = runners.filter((r) => !r.isNonRunner);
  const withdrawn = runners.filter((r) => r.isNonRunner);

  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Runners and riders</caption>
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-muted">
          <th scope="col" className="px-2 pb-2 font-semibold">
            No <span className="normal-case">(Dr)</span>
          </th>
          <th scope="col" className="px-2 pb-2 font-semibold">
            Horse
          </th>
          <th scope="col" className="px-2 pb-2 font-semibold">
            Form
          </th>
          <th scope="col" className="px-2 pb-2 font-semibold">
            Age / Wgt
          </th>
          <th scope="col" className="px-2 pb-2 font-semibold" title="Official rating">
            OR
          </th>
          <th scope="col" className="px-2 pb-2 font-semibold" title="Racing Post Rating">
            RPR
          </th>
        </tr>
      </thead>
      <tbody>
        {declared.map((r) => (
          <RunnerRow key={r.horseId} runner={r} />
        ))}
        {withdrawn.map((r) => (
          <RunnerRow key={r.horseId} runner={r} />
        ))}
      </tbody>
    </table>
  );
}
