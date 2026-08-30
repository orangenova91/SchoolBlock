"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";

type RequestItem = {
  id: string;
  schoolName: string;
  sido: string;
  type: string;
  manual: boolean;
  teacherName: string;
  teacherPhone: string;
  teacherEmail: string | null;
  teacherRole: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  processedBy: string | null;
  rejectReason: string | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
};

type SchoolAccount = {
  id: string;
  username: string;
  createdAt: string;
  termCount: number;
};

type Tab = "pending" | "processed" | "accounts";

const INPUT =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generatePassword(length = 10): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length],
  ).join("");
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ko-KR");
}

function statusLabel(status: RequestItem["status"]): string {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  return "대기";
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function AdminConsole() {
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [accounts, setAccounts] = useState<SchoolAccount[]>([]);
  const [accountTotal, setAccountTotal] = useState(0);
  const [accountQuery, setAccountQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(
    null,
  );
  const [resetAccount, setResetAccount] = useState<SchoolAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SchoolAccount | null>(null);

  const loadRequests = useCallback(async () => {
    const response = await fetch("/api/admin/account-requests");
    const data = (await response.json()) as {
      items?: RequestItem[];
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "목록을 불러오지 못했습니다.");
    setRequests(Array.isArray(data.items) ? data.items : []);
  }, []);

  const loadAccounts = useCallback(async (q: string, updateList = true) => {
    const response = await fetch(
      `/api/admin/accounts?q=${encodeURIComponent(q.trim())}`,
    );
    const data = (await response.json()) as {
      items?: SchoolAccount[];
      total?: number;
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "계정을 불러오지 못했습니다.");
    const items = Array.isArray(data.items) ? data.items : [];
    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (updateList) setAccounts(items);
    if (typeof data.total === "number") setAccountTotal(data.total);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");
    void loadRequests()
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "목록을 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void loadAccounts("", false).catch(() => {});
    return () => {
      cancelled = true;
    };
    // Mount-only: loadRequests / loadAccounts are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab !== "accounts") return;
    const handle = setTimeout(() => {
      void loadAccounts(accountQuery).catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : "계정을 불러오지 못했습니다.",
        );
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [tab, accountQuery, loadAccounts]);

  const pending = requests.filter((item) => item.status === "pending");
  const processed = requests.filter((item) => item.status !== "pending");

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["pending", `대기 신청 (${pending.length})`],
            ["processed", `처리됨 (${processed.length})`],
            ["accounts", `학교 계정 관리 (${accountTotal})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              tab === id
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {issued ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-semibold">계정 정보를 카카오톡으로 전달해 주세요.</p>
          <p className="mt-2">
            아이디: <span className="font-medium">{issued.username}</span>
            <button
              type="button"
              className="ml-2 underline underline-offset-2"
              onClick={() => void copyText(issued.username)}
            >
              복사
            </button>
          </p>
          <p>
            비밀번호: <span className="font-medium">{issued.password}</span>
            <button
              type="button"
              className="ml-2 underline underline-offset-2"
              onClick={() => void copyText(issued.password)}
            >
              복사
            </button>
          </p>
          <button
            type="button"
            className="mt-2 text-xs text-emerald-800 underline underline-offset-2"
            onClick={() => setIssued(null)}
          >
            닫기
          </button>
        </div>
      ) : null}

      {info ? (
        <p role="status" className="text-sm text-zinc-700">
          {info}
        </p>
      ) : null}

      {message ? (
        <p role="status" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-zinc-500">불러오는 중…</p> : null}

      {tab === "pending" && !loading ? (
        pending.length === 0 ? (
          <p className="text-sm text-zinc-500">대기 중인 신청이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {pending.map((item) => (
              <PendingRequestCard
                key={item.id}
                item={item}
                onError={setMessage}
                onApproved={(username, password) => {
                  setIssued({ username, password });
                  setMessage("");
                  void loadRequests();
                  void loadAccounts(accountQuery, false);
                }}
                onRejected={() => {
                  setMessage("");
                  void loadRequests();
                }}
              />
            ))}
          </ul>
        )
      ) : null}

      {tab === "processed" && !loading ? (
        processed.length === 0 ? (
          <p className="text-sm text-zinc-500">처리된 신청이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="w-12 px-3 py-2 text-center font-medium">순</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">학교</th>
                  <th className="px-3 py-2 font-medium">교사</th>
                  <th className="px-3 py-2 font-medium">처리</th>
                </tr>
              </thead>
              <tbody>
                {processed.map((item, index) => (
                  <tr key={item.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-3 py-2.5 text-center tabular-nums text-zinc-500">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2.5">{statusLabel(item.status)}</td>
                    <td className="px-3 py-2.5">
                      {item.schoolName}
                      <span className="text-zinc-500">
                        {" "}
                        · {item.sido} · {item.type || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {item.teacherName}
                      <span className="text-zinc-500"> · {item.teacherPhone}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500">
                      {item.processedBy ?? "—"}
                      {" · "}
                      {formatWhen(item.approvedAt ?? item.rejectedAt)}
                      {item.rejectReason ? ` · ${item.rejectReason}` : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "accounts" ? (
        <div className="flex flex-col gap-4">
          <input
            type="search"
            value={accountQuery}
            onChange={(e) => setAccountQuery(e.target.value)}
            placeholder="학교명(아이디) 검색"
            className={INPUT}
          />
          {accounts.length === 0 ? (
            <p className="text-sm text-zinc-500">학교 계정이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="w-12 px-3 py-2 text-center font-medium">순</th>
                    <th className="px-3 py-2 font-medium">아이디</th>
                    <th className="px-3 py-2 font-medium">생성일</th>
                    <th className="px-3 py-2 font-medium">시간표</th>
                    <th className="px-3 py-2 text-right font-medium">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account, index) => (
                    <tr
                      key={account.id}
                      className="border-b border-zinc-100 last:border-0"
                    >
                      <td className="px-3 py-2.5 text-center tabular-nums text-zinc-500">
                        {index + 1}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-zinc-900">
                        {account.username}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600">
                        {formatWhen(account.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600">
                        {account.termCount}개
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setMessage("");
                              setResetAccount(account);
                            }}
                            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                          >
                            비밀번호 재설정
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMessage("");
                              setDeleteTarget(account);
                            }}
                            className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {resetAccount ? (
        <PasswordResetModal
          account={resetAccount}
          onClose={() => setResetAccount(null)}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteAccountModal
          account={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(username) => {
            setDeleteTarget(null);
            setIssued(null);
            setMessage("");
            setInfo(`${username} 계정과 시간표 데이터를 삭제했습니다.`);
            void loadAccounts(accountQuery);
          }}
        />
      ) : null}
    </div>
  );
}

function PendingRequestCard({
  item,
  onApproved,
  onRejected,
  onError,
}: {
  item: RequestItem;
  onApproved: (username: string, password: string) => void;
  onRejected: () => void;
  onError: (message: string) => void;
}) {
  const [username, setUsername] = useState(item.schoolName);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function approve() {
    setBusy("approve");
    onError("");
    try {
      const response = await fetch(
        `/api/admin/account-requests/${item.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        username?: string;
        password?: string;
      };
      if (!response.ok || !data.username || !data.password) {
        onError(data.error ?? "승인에 실패했습니다.");
        return;
      }
      onApproved(data.username, data.password);
    } catch {
      onError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    onError("");
    try {
      const response = await fetch(
        `/api/admin/account-requests/${item.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        onError(data.error ?? "반려에 실패했습니다.");
        return;
      }
      onRejected();
    } catch {
      onError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div>
        <p className="font-semibold text-zinc-900">{item.schoolName}</p>
        <p className="text-sm text-zinc-500">
          {item.sido} · {item.type || "—"}
          {item.manual ? " · 직접 입력" : ""}
          {" · "}
          {formatWhen(item.createdAt)}
        </p>
      </div>
      <dl className="grid gap-1 text-sm text-zinc-700 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-zinc-500">담당 교사</dt>
          <dd>
            {item.teacherName}
            {item.teacherRole ? ` · ${item.teacherRole}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">연락처</dt>
          <dd>
            {item.teacherPhone}
            {item.teacherEmail ? ` · ${item.teacherEmail}` : ""}
          </dd>
        </div>
        {item.note ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-zinc-500">문의</dt>
            <dd className="whitespace-pre-wrap">{item.note}</dd>
          </div>
        ) : null}
      </dl>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-label="아이디"
          className={INPUT}
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="비밀번호"
            placeholder={`비밀번호 (${MIN_PASSWORD_LENGTH}자 이상)`}
            className={INPUT}
          />
          <button
            type="button"
            onClick={() => setPassword(generatePassword())}
            className="shrink-0 rounded-lg border border-zinc-300 px-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
          >
            만들기
          </button>
        </div>
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="반려 사유 (선택)"
        className={INPUT}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void approve()}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          {busy === "approve" ? "승인 중…" : "승인"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void reject()}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          {busy === "reject" ? "반려 중…" : "반려"}
        </button>
      </div>
    </li>
  );
}

function Modal({
  title,
  description,
  busy = false,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-modal-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3
          id="admin-modal-title"
          className="text-base font-semibold text-zinc-900"
        >
          {title}
        </h3>
        {description ? (
          <p className="mt-1 text-sm text-zinc-600">{description}</p>
        ) : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function PasswordResetModal({
  account,
  onClose,
}: {
  account: SchoolAccount;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{
    username: string;
    password: string;
  } | null>(null);

  async function resetPassword() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/accounts/${account.id}/password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        username?: string;
        password?: string;
      };
      if (!response.ok || !data.username || !data.password) {
        setError(data.error ?? "비밀번호를 바꾸지 못했습니다.");
        return;
      }
      setIssued({ username: data.username, password: data.password });
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <Modal
        title="비밀번호를 재설정했습니다"
        description="계정 정보를 카카오톡으로 전달해 주세요."
        onClose={onClose}
      >
        <p className="text-sm text-zinc-800">
          아이디: <span className="font-medium">{issued.username}</span>
          <button
            type="button"
            className="ml-2 text-xs font-medium underline underline-offset-2"
            onClick={() => void copyText(issued.username)}
          >
            복사
          </button>
        </p>
        <p className="mt-1 text-sm text-zinc-800">
          비밀번호: <span className="font-medium">{issued.password}</span>
          <button
            type="button"
            className="ml-2 text-xs font-medium underline underline-offset-2"
            onClick={() => void copyText(issued.password)}
          >
            복사
          </button>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          닫기
        </button>
      </Modal>
    );
  }

  return (
    <Modal
      title="비밀번호 재설정"
      description={`${account.username} 계정의 새 비밀번호를 정합니다.`}
      busy={busy}
      onClose={onClose}
    >
      <div className="flex gap-2">
        <input
          type="text"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`${MIN_PASSWORD_LENGTH}자 이상`}
          className={INPUT}
        />
        <button
          type="button"
          onClick={() => setPassword(generatePassword())}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        >
          만들기
        </button>
      </div>
      {error ? (
        <p role="status" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          취소
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resetPassword()}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          {busy ? "저장 중…" : "재설정"}
        </button>
      </div>
    </Modal>
  );
}

function DeleteAccountModal({
  account,
  onClose,
  onDeleted,
}: {
  account: SchoolAccount;
  onClose: () => void;
  onDeleted: (username: string) => void;
}) {
  const [confirmUsername, setConfirmUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canDelete = confirmUsername.trim() === account.username;

  async function deleteAccount() {
    if (!canDelete) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/accounts/${account.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmUsername }),
      });
      const data = (await response.json()) as {
        error?: string;
        username?: string;
      };
      if (!response.ok || !data.username) {
        setError(data.error ?? "계정을 삭제하지 못했습니다.");
        return;
      }
      onDeleted(data.username);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="계정 삭제"
      description={`${account.username} 계정과 시간표 ${account.termCount}개가 함께 삭제됩니다. 확인을 위해 아이디를 입력하세요.`}
      busy={busy}
      onClose={onClose}
    >
      <input
        type="text"
        autoFocus
        value={confirmUsername}
        onChange={(e) => setConfirmUsername(e.target.value)}
        placeholder={account.username}
        autoComplete="off"
        className={INPUT}
      />
      {error ? (
        <p role="status" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          취소
        </button>
        <button
          type="button"
          disabled={busy || !canDelete}
          onClick={() => void deleteAccount()}
          className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "삭제 중…" : "삭제"}
        </button>
      </div>
    </Modal>
  );
}
