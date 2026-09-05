"use client";

/**
 * Account form.
 *
 * Every input is optimistic: values live in local state until Save. Save
 * calls the server action, which re-sanitises everything server-side — the
 * client copy is a courtesy for the user, not the check that counts.
 *
 * The security section deliberately does NOT hide behind a spinner during
 * destructive actions. Sign out everywhere and delete are both server-side
 * redirects — the browser lands somewhere different, which is a clearer
 * signal that it worked than any inline "done" toast.
 */

import { useRef, useState, useTransition } from "react";
import {
  deleteAccountAction,
  requestEmailChangeAction,
  saveNamesAction,
  signOutEverywhereAction,
} from "../actions";

export function AccountForm({
  email,
  displayName,
  stableName: stableNameProp,
  preview,
}: {
  email: string;
  displayName: string;
  stableName?: string | null;
  preview: boolean;
}) {
  const [name, setName] = useState(displayName);
  const [stableName, setStableName] = useState(stableNameProp ?? `${displayName}’s Stable`);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [saveMsg, setSaveMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pendingSave, saveTransition] = useTransition();

  const [showEmailChange, setShowEmailChange] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pendingEmail, emailTransition] = useTransition();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState("");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [pendingDelete, deleteTransition] = useTransition();

  function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarPreview(URL.createObjectURL(file));
    // Real upload happens once the storage layer exists (Vercel Blob / R2).
    // For now this is a local preview only.
  }

  function submitNames() {
    setSaveMsg(null);
    if (preview) {
      setSaveMsg({ tone: "ok", text: "Preview mode — not saved." });
      return;
    }
    saveTransition(async () => {
      const result = await saveNamesAction(name, stableName);
      setSaveMsg(
        result.ok
          ? { tone: "ok", text: "Saved." }
          : { tone: "bad", text: result.error ?? "Could not save." }
      );
    });
  }

  function submitEmail() {
    setEmailMsg(null);
    if (preview) {
      setEmailMsg({ tone: "ok", text: "Preview mode — no email sent." });
      return;
    }
    emailTransition(async () => {
      const result = await requestEmailChangeAction(newEmail);
      setEmailMsg(
        result.ok
          ? { tone: "ok", text: "Sent — tap the link in the new inbox to confirm." }
          : { tone: "bad", text: result.error ?? "Could not send." }
      );
      if (result.ok) setNewEmail("");
    });
  }

  function submitDelete() {
    setDeleteMsg(null);
    if (preview) {
      setDeleteMsg("Preview mode — account not deleted.");
      return;
    }
    deleteTransition(async () => {
      const result = await deleteAccountAction(deleteWord);
      if (!result.ok) setDeleteMsg(result.error ?? "Could not delete.");
    });
  }

  return (
    <>
      {/* Profile */}
      <section className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <SectionHead title="Profile" />

        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#eef2f6] text-[var(--slate-soft)]"
            aria-label="Change avatar"
          >
            {avatarPreview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <PersonIcon />
            )}
            <span className="absolute inset-x-0 bottom-0 bg-[var(--slate)]/70 py-0.5 text-center text-[9px] font-bold uppercase tracking-wider text-white">
              Change
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onAvatar}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold text-[var(--slate)]">{name}</p>
            <p className="truncate text-[12.5px] text-[var(--slate-soft)]">{email}</p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <Field
            label="Display Name"
            hint="Shown next to your points on any leaderboard."
            value={name}
            onChange={setName}
            maxLength={30}
          />
          <Field
            label="Stable Name"
            hint="Your team's brand — what mates see when they beat you (or don't)."
            value={stableName}
            onChange={setStableName}
            maxLength={40}
          />
        </div>

        {saveMsg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] font-semibold ${
              saveMsg.tone === "ok"
                ? "bg-[#eaf7f0] text-[var(--go-deep)]"
                : "bg-[#fdecec] text-[#c0392b]"
            }`}
          >
            {saveMsg.text}
          </p>
        )}

        <button
          type="button"
          onClick={submitNames}
          disabled={pendingSave}
          className="mt-5 w-full rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] py-3 text-[14px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:opacity-60"
        >
          {pendingSave ? "Saving…" : "Save changes"}
        </button>
      </section>

      {/* Email */}
      <section className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <SectionHead title="Sign-in email" />
        <p className="mt-2 text-[13px] text-[var(--slate-soft)]">
          This is where sign-in links come. Changing it sends a magic link to the new address to
          confirm it&rsquo;s yours.
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#eef2f6] px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--slate)]">{email}</span>
          <button
            type="button"
            onClick={() => setShowEmailChange((v) => !v)}
            className="text-[12px] font-bold text-[var(--go-deep)] underline underline-offset-2"
          >
            {showEmailChange ? "Cancel" : "Change"}
          </button>
        </div>
        {showEmailChange && (
          <div className="mt-3">
            <label htmlFor="new-email" className="text-[12px] font-bold text-[var(--slate)]">
              New email
            </label>
            <input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="you@newplace.com"
              className="mt-1 w-full rounded-xl border border-[#eef2f6] px-3.5 py-2.5 text-[14px] outline-none focus:border-[var(--go-deep)] focus:ring-2 focus:ring-[var(--go-deep)]/25"
            />
            {emailMsg && (
              <p
                className={`mt-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold ${
                  emailMsg.tone === "ok"
                    ? "bg-[#eaf7f0] text-[var(--go-deep)]"
                    : "bg-[#fdecec] text-[#c0392b]"
                }`}
              >
                {emailMsg.text}
              </p>
            )}
            <button
              type="button"
              onClick={submitEmail}
              disabled={pendingEmail || !newEmail.trim()}
              className="mt-3 w-full rounded-xl bg-[var(--slate)] py-3 text-[14px] font-extrabold text-white disabled:opacity-60"
            >
              {pendingEmail ? "Sending…" : "Send confirmation link"}
            </button>
          </div>
        )}
      </section>

      {/* Security — no passwords to reset. Sessions + delete are the honest controls. */}
      <section className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <SectionHead title="Security" />

        <form action={signOutEverywhereAction}>
          <SecurityAction
            label="Sign out everywhere"
            hint="Kills every active session on every device. You'll need to sign in again here."
            actionLabel="Sign out everywhere"
          />
        </form>

        <div className="mt-3">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center justify-between rounded-xl border border-[#f4d0cc] px-4 py-3 text-left"
            >
              <div>
                <div className="text-[13.5px] font-extrabold text-[#c0392b]">Delete account</div>
                <div className="text-[11.5px] text-[var(--slate-soft)]">
                  Removes you, your stable, your picks. Cannot be undone.
                </div>
              </div>
              <span className="text-[#c0392b]">›</span>
            </button>
          ) : (
            <div className="rounded-xl border border-[#f4d0cc] bg-[#fdecec] p-4">
              <p className="text-[13px] font-bold text-[#a3261f]">
                Type DELETE to confirm — this cannot be undone.
              </p>
              <input
                value={deleteWord}
                onChange={(e) => setDeleteWord(e.target.value)}
                autoFocus
                className="mt-2 w-full rounded-xl border border-[#f4d0cc] bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-[#c0392b]"
                placeholder="DELETE"
              />
              {deleteMsg && (
                <p className="mt-2 text-[12.5px] font-semibold text-[#a3261f]">{deleteMsg}</p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteWord("");
                    setDeleteMsg(null);
                  }}
                  className="rounded-xl bg-white py-2.5 text-[13px] font-bold text-[var(--slate)]"
                >
                  Keep account
                </button>
                <button
                  type="button"
                  onClick={submitDelete}
                  disabled={pendingDelete || deleteWord !== "DELETE"}
                  className="rounded-xl bg-[#c0392b] py-2.5 text-[13px] font-extrabold text-white disabled:opacity-60"
                >
                  {pendingDelete ? "Deleting…" : "Delete for good"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ parts */

function SectionHead({ title }: { title: string }) {
  return (
    <h2 className="text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
      {title}
    </h2>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[12px] font-bold text-[var(--slate)]">{label}</label>
        <span className="text-[10.5px] text-[var(--slate-soft)]">
          {value.length}/{maxLength}
        </span>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="mt-1 w-full rounded-xl border border-[#eef2f6] px-3.5 py-2.5 text-[14px] text-[var(--slate)] outline-none focus:border-[var(--go-deep)] focus:ring-2 focus:ring-[var(--go-deep)]/25"
      />
      <p className="mt-1 text-[11.5px] text-[var(--slate-soft)]">{hint}</p>
    </div>
  );
}

function SecurityAction({
  label,
  hint,
  actionLabel,
}: {
  label: string;
  hint: string;
  actionLabel: string;
}) {
  return (
    <button
      type="submit"
      className="flex w-full items-center justify-between rounded-xl border border-[#eef2f6] px-4 py-3 text-left"
      aria-label={actionLabel}
    >
      <div>
        <div className="text-[13.5px] font-extrabold text-[var(--slate)]">{label}</div>
        <div className="text-[11.5px] text-[var(--slate-soft)]">{hint}</div>
      </div>
      <span className="text-[var(--slate-soft)]">›</span>
    </button>
  );
}

function PersonIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
