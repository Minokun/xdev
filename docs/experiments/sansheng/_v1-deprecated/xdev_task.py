#!/usr/bin/env python3
"""xdev-task — 三省模式组件 B：任务状态机 CLI（原型）

移植自 edict kanban_update.py 的制度内核：
  1. _VALID_TRANSITIONS 严格状态机，非法跳转拒绝
  2. HIGH_RISK_TRANSITIONS → PendingConfirm，须确认权方（confirm-authority）放行
  3. 每次流转 append-only 审计日志（奏折）

用法:
  xdev_task.py init <title>                 # 创建 .opendev/task.json
  xdev_task.py transition <state> [note]    # 状态流转（校验合法性/高风险）
  xdev_task.py confirm [note]               # 确认权方放行 PendingConfirm
  xdev_task.py show                         # 查看当前状态与审计尾
"""
import json, sys, os, datetime

TASK_FILE = ".opendev/task.json"
AUDIT_FILE = ".opendev/audit.jsonl"

VALID_TRANSITIONS = {
    "Pending":     {"Planned", "Cancelled"},
    "Planned":     {"Reviewed", "Blocked", "Cancelled"},   # Reviewed 由门下门准奏写入
    "Reviewed":    {"Executing", "Planned", "Cancelled"},  # Planned = 封驳打回
    "Executing":   {"Verifying", "Blocked", "Cancelled"},
    "Verifying":   {"Done", "Executing", "Blocked", "Cancelled"},
    "Blocked":     {"Planned", "Executing", "Cancelled"},
    "PendingConfirm": set(),                                # 只能经 confirm 放行
    "Done":        set(),
    "Cancelled":   set(),
}

HIGH_RISK = {
    ("Verifying", "Done"): "menxia",        # 完结须门下门复核确认
    ("Executing", "Cancelled"): "user",     # 执行中取消须用户确认
}
CONFIRM_AUTHORITY = "menxia"  # PendingConfirm 的放行方；简化原型由 menxia 统一放行

def now():
    return datetime.datetime.now().isoformat(timespec="seconds")

def load():
    with open(TASK_FILE) as f:
        return json.load(f)

def save(t):
    os.makedirs(".opendev", exist_ok=True)
    with open(TASK_FILE, "w") as f:
        json.dump(t, f, ensure_ascii=False, indent=2)

def audit(event):
    os.makedirs(".opendev", exist_ok=True)
    with open(AUDIT_FILE, "a") as f:
        f.write(json.dumps({"ts": now(), **event}, ensure_ascii=False) + "\n")

def cmd_init(title):
    save({"title": title, "state": "Pending", "created": now(), "history": []})
    audit({"event": "init", "title": title})
    print(f"✅ task created: {title} [Pending]")

def cmd_transition(new_state, note=""):
    t = load()
    old = t["state"]
    if old == "PendingConfirm":
        sys.exit(f"⛔ 当前处于 PendingConfirm，须由 {CONFIRM_AUTHORITY} 执行 confirm 放行（目标: {t['pending_target']}）")
    allowed = VALID_TRANSITIONS.get(old, set())
    if new_state not in allowed:
        sys.exit(f"⛔ 非法状态转换: {old} → {new_state}（允许: {sorted(allowed) or '无（终态/待确认）'}）")
    if (old, new_state) in HIGH_RISK:
        t["state"] = "PendingConfirm"
        t["pending_target"] = new_state
        t["confirm_by"] = HIGH_RISK[(old, new_state)]
        save(t)
        audit({"event": "pending_confirm", "from": old, "target": new_state,
               "confirm_by": t["confirm_by"], "note": note})
        print(f"⚠️  高风险转换 {old}→{new_state} 已拦截，进入 PendingConfirm（待 {t['confirm_by']} 确认）")
        return
    t["state"] = new_state
    t["history"].append({"from": old, "to": new_state, "ts": now(), "note": note})
    t.pop("pending_target", None)
    save(t)
    audit({"event": "transition", "from": old, "to": new_state, "note": note})
    print(f"✅ {old} → {new_state}")

def cmd_confirm(note=""):
    t = load()
    if t["state"] != "PendingConfirm":
        sys.exit(f"⛔ 当前状态 {t['state']} 不是 PendingConfirm，无需确认")
    old_target = t["pending_target"]
    t["history"].append({"from": "PendingConfirm", "to": old_target, "ts": now(),
                         "note": f"confirmed by {t.get('confirm_by')}: {note}"})
    t["state"] = old_target
    t.pop("pending_target", None); t.pop("confirm_by", None)
    save(t)
    audit({"event": "confirm", "to": old_target, "note": note})
    print(f"✅ 已确认放行 → {old_target}")

def cmd_show():
    t = load()
    print(json.dumps(t, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    cmds = {"init": cmd_init, "transition": cmd_transition,
            "confirm": cmd_confirm, "show": cmd_show}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "init" and args: cmd_init(args[0])
    elif cmd == "transition" and args: cmd_transition(args[0], args[1] if len(args) > 1 else "")
    elif cmd == "confirm": cmd_confirm(args[0] if args else "")
    elif cmd == "show": cmd_show()
    else: sys.exit(__doc__)
