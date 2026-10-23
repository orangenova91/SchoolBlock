"use client";

import { useMemo, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { TeacherRoster } from "@/components/teachers-form";
import { MAX_TEACHER_GROUP_NAME, type Teacher } from "@/lib/types";

const TEACHER_NAME_MIME = "application/x-sb-teacher-name";
const GROUP_MIME = "application/x-sb-teacher-group";

const byKorean = (a: string, b: string) => a.localeCompare(b, "ko");

/**
 * v3 교사 배정: "교사 명단" 옆 톱니바퀴. 누르면 교사 그룹화 모달을 연다.
 * 왼쪽 교사를 오른쪽 그룹에 끌어 놓으면 그 교사의 group이 그 그룹명이 된다 (한 교사는 한 그룹에만).
 * 바꾼 내용은 교사 배정의 저장 버튼으로 명단과 함께 저장된다.
 * 모달은 body로 띄운다: 교사 배정 form 안에 있으면 입력창 Enter가 명단 저장으로 이어진다.
 */
export function V3TeacherGrouping({ teachers, groups, onChange }: TeacherRoster) {
  const [open, setOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** 순서를 바꾸려고 끌고 있는 그룹 */
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  /** 끌고 있는 그룹이 들어갈 자리 (0 = 맨 위, groups.length = 맨 아래) */
  const [insertAt, setInsertAt] = useState<number | null>(null);

  /** 이름별 소속 그룹 (같은 이름이 여러 줄이면 첫 줄 기준) */
  const groupOf = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const t of teachers) {
      const name = t.name.trim();
      if (name && !map.has(name)) map.set(name, t.group && groups.includes(t.group) ? t.group : undefined);
    }
    return map;
  }, [teachers, groups]);
  const ungrouped = [...groupOf].filter(([, g]) => !g).map(([name]) => name).sort(byKorean);
  const membersOf = (group: string) => [...groupOf].filter(([, g]) => g === group).map(([name]) => name).sort(byKorean);

  const trimmedName = groupName.trim();
  const duplicate = groups.includes(trimmedName);
  const editValue = editing?.value.trim() ?? "";
  const editDuplicate = editing !== null && editValue !== editing.name && groups.includes(editValue);

  /** 이 이름의 교사(같은 이름 여러 줄 모두)를 그룹에 넣거나 뺀다 */
  function setTeacherGroup(name: string, group: string | undefined) {
    onChange(
      teachers.map((t): Teacher => (t.name.trim() === name ? { ...t, group } : t)),
      groups,
    );
  }

  function createGroup() {
    if (!trimmedName || duplicate) return;
    onChange(teachers, [...groups, trimmedName]);
    setGroupName("");
  }

  function saveEdit() {
    if (!editing || !editValue || editDuplicate) return;
    const from = editing.name;
    onChange(
      teachers.map((t) => (t.group === from ? { ...t, group: editValue } : t)),
      groups.map((g) => (g === from ? editValue : g)),
    );
    setEditing(null);
  }

  function removeGroup(group: string) {
    const count = membersOf(group).length;
    const detail = count > 0 ? `\n이 그룹의 교사 ${count}명은 그룹에서 빠집니다.` : "";
    if (!window.confirm(`"${group}" 그룹을 삭제할까요?${detail}`)) return;
    onChange(
      teachers.map((t) => (t.group === group ? { ...t, group: undefined } : t)),
      groups.filter((g) => g !== group),
    );
    if (editing?.name === group) setEditing(null);
  }

  function startDrag(event: DragEvent<HTMLElement>, name: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TEACHER_NAME_MIME, name);
  }

  function startGroupDrag(event: DragEvent<HTMLElement>, group: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(GROUP_MIME, group);
    const card = event.currentTarget.closest("li");
    if (card) event.dataTransfer.setDragImage(card, 16, 16);
    setDraggingGroup(group);
  }

  function endGroupDrag() {
    setDraggingGroup(null);
    setInsertAt(null);
  }

  /** 교사를 끌면 그 그룹 카드를 칠하고, 그룹을 끌면 카드 위·아래 절반에 따라 끼워 넣을 자리를 정한다 */
  function dragOverGroup(event: DragEvent<HTMLElement>, group: string, index: number) {
    const types = event.dataTransfer.types;
    if (types.includes(GROUP_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      setInsertAt(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
      return;
    }
    if (!types.includes(TEACHER_NAME_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(group);
  }

  function dropOnGroup(event: DragEvent<HTMLElement>, group: string) {
    const name = event.dataTransfer.getData(TEACHER_NAME_MIME);
    if (!name) return;
    event.preventDefault();
    setDropTarget(null);
    setTeacherGroup(name, group);
  }

  /** 그룹 목록 어디에 놓아도 (카드 사이 틈 포함) 표시된 구분선 자리로 옮긴다 */
  function dropInGroupList(event: DragEvent<HTMLElement>) {
    const moved = event.dataTransfer.getData(GROUP_MIME);
    if (!moved) return;
    event.preventDefault();
    const fromIndex = groups.indexOf(moved);
    if (fromIndex >= 0 && lineAt !== null) {
      const next = groups.filter((g) => g !== moved);
      next.splice(lineAt > fromIndex ? lineAt - 1 : lineAt, 0, moved);
      onChange(teachers, next);
    }
    endGroupDrag();
  }

  /** 끌고 있는 그룹의 제자리(바로 위·아래)에는 구분선을 그리지 않는다 */
  const draggingIndex = draggingGroup ? groups.indexOf(draggingGroup) : -1;
  const lineAt = insertAt !== null && insertAt !== draggingIndex && insertAt !== draggingIndex + 1 ? insertAt : null;

  return (
    <>
      <button
        type="button"
        aria-label="교사 그룹화"
        title="교사 그룹화"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-zinc-300 bg-white p-1.5 text-zinc-700 transition hover:bg-zinc-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="v3-teacher-grouping-title"
              onClick={() => setOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            >
              <section
                className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="v3-teacher-grouping-title" className="text-base font-semibold text-zinc-900">
                      교사 그룹화
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      왼쪽 교사를 오른쪽 그룹으로 끌어다 놓으세요. 한 교사는 한 그룹에만 들어갑니다. 그룹 순서는 ⠿를 끌어
                      바꿉니다. 바꾼 내용은 교사 배정의 저장 버튼을 눌러야 저장됩니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setOpen(false)}
                    className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    닫기
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <section className="rounded-xl border border-zinc-200 p-4">
                    <h3 className="text-sm font-semibold text-zinc-900">교사 명단</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      그룹에 넣지 않은 교사 {ungrouped.length}명 (가나다순) · 전체 {groupOf.size}명
                    </p>
                    {groupOf.size === 0 ? (
                      <p className="mt-3 text-sm text-zinc-500">입력된 교사가 없습니다.</p>
                    ) : ungrouped.length === 0 ? (
                      <p className="mt-3 text-sm text-zinc-500">모든 교사가 그룹에 들어갔습니다.</p>
                    ) : (
                      <ol className="mt-3 flex max-h-[60vh] flex-col divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200">
                        {ungrouped.map((name, i) => (
                          <li
                            key={name}
                            draggable
                            onDragStart={(e) => startDrag(e, name)}
                            onDragEnd={() => setDropTarget(null)}
                            title="그룹으로 끌어다 놓기"
                            className="flex cursor-grab items-center gap-3 px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 active:cursor-grabbing"
                          >
                            <span className="w-6 text-right text-xs text-zinc-400">{i + 1}</span>
                            {name}
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>

                  <section className="rounded-xl border border-zinc-200 p-4">
                    <h3 className="text-sm font-semibold text-zinc-900">그룹</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">그룹 {groups.length}개</p>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="text"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                          e.preventDefault();
                          createGroup();
                        }}
                        placeholder="그룹명 입력"
                        aria-label="그룹명"
                        maxLength={MAX_TEACHER_GROUP_NAME}
                        className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500"
                      />
                      <button
                        type="button"
                        onClick={createGroup}
                        disabled={!trimmedName || duplicate}
                        className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        그룹 생성
                      </button>
                    </div>
                    {duplicate ? <p className="mt-1 text-xs text-red-600">이미 있는 그룹명입니다.</p> : null}
                    {groups.length === 0 ? (
                      <p className="mt-3 text-sm text-zinc-500">아직 만든 그룹이 없습니다.</p>
                    ) : (
                      <ul
                        className="mt-3 flex max-h-[60vh] flex-col gap-2 overflow-y-auto py-1"
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes(GROUP_MIME)) e.preventDefault();
                        }}
                        onDrop={dropInGroupList}
                      >
                        {groups.map((group, index) => {
                          const members = membersOf(group);
                          return (
                            <li
                              key={group}
                              onDragOver={(e) => dragOverGroup(e, group, index)}
                              onDragLeave={() => setDropTarget((cur) => (cur === group ? null : cur))}
                              onDrop={(e) => dropOnGroup(e, group)}
                              className={`relative rounded-lg border px-3 py-2 transition ${
                                draggingGroup === group
                                  ? "border-zinc-200 bg-zinc-50 opacity-50"
                                  : dropTarget === group
                                    ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
                                    : "border-zinc-200 bg-zinc-50"
                              }`}
                            >
                              {lineAt === index ? (
                                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-[5px] h-0.5 rounded-full bg-sky-500" />
                              ) : null}
                              {lineAt === groups.length && index === groups.length - 1 ? (
                                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-[5px] h-0.5 rounded-full bg-sky-500" />
                              ) : null}
                              {editing?.name === group ? (
                                <>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      autoFocus
                                      value={editing.value}
                                      onChange={(e) => setEditing({ name: group, value: e.target.value })}
                                      onKeyDown={(e) => {
                                        if (e.nativeEvent.isComposing) return;
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          saveEdit();
                                        } else if (e.key === "Escape") {
                                          e.stopPropagation();
                                          setEditing(null);
                                        }
                                      }}
                                      aria-label="그룹명 수정"
                                      maxLength={MAX_TEACHER_GROUP_NAME}
                                      className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={saveEdit}
                                      disabled={!editValue || editDuplicate}
                                      className="shrink-0 rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      저장
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditing(null)}
                                      className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                                    >
                                      취소
                                    </button>
                                  </div>
                                  {editDuplicate ? <p className="mt-1 text-xs text-red-600">이미 있는 그룹명입니다.</p> : null}
                                </>
                              ) : (
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span
                                      draggable
                                      onDragStart={(e) => startGroupDrag(e, group)}
                                      onDragEnd={endGroupDrag}
                                      title="끌어서 그룹 순서 바꾸기"
                                      aria-label={`${group} 순서 바꾸기`}
                                      className="cursor-grab select-none px-0.5 text-base leading-none text-zinc-400 hover:text-zinc-700 active:cursor-grabbing"
                                    >
                                      ⠿
                                    </span>
                                    <p className="min-w-0 truncate text-sm font-medium text-zinc-900">
                                      {group} <span className="text-xs font-normal text-zinc-500">{members.length}명</span>
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditing({ name: group, value: group })}
                                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                                    >
                                      수정
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeGroup(group)}
                                      className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                                    >
                                      삭제
                                    </button>
                                  </div>
                                </div>
                              )}
                              {members.length === 0 ? (
                                <p className="mt-1 text-xs text-zinc-500">교사를 여기로 끌어다 놓으세요.</p>
                              ) : (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {members.map((name) => (
                                    <span
                                      key={name}
                                      draggable
                                      onDragStart={(e) => startDrag(e, name)}
                                      onDragEnd={() => setDropTarget(null)}
                                      title="다른 그룹으로 끌어 옮기기"
                                      className="inline-flex cursor-grab items-center gap-1 rounded-full border border-zinc-300 bg-white py-0.5 pl-2.5 pr-1 text-xs text-zinc-800"
                                    >
                                      {name}
                                      <button
                                        type="button"
                                        aria-label={`${name} 그룹에서 빼기`}
                                        onClick={() => setTeacherGroup(name, undefined)}
                                        className="rounded-full px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
