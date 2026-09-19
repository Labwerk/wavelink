"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { api } from "../../../../backend/_generated/api";
import type { Id } from "../../../../backend/_generated/dataModel";

const ROLES = ["viewer", "operator", "maintenance", "admin"] as const;
type Role = (typeof ROLES)[number];

// User and role administration (spec R7/R9). Only rendered for callers whose
// capability list includes `user.manage`; every function it calls
// (users.list / setRole / createUser, audit.list) re-checks that capability
// on the server, so this gate is cosmetic.
export default function AdminUsersPage() {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <p>Loading…</p>
      </main>
    );
  }
  if (me === null || !me.capabilities.includes("user.manage")) {
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <p>Not available.</p>
        <Link href="/">Back to dashboard</Link>
      </main>
    );
  }
  return <UserAdmin currentUserId={me._id} />;
}

function UserAdmin({ currentUserId }: { currentUserId: Id<"users"> }) {
  const users = useQuery(api.users.list);
  const audit = useQuery(api.audit.list, { limit: 25 });
  const setRole = useMutation(api.users.setRole);
  const setActive = useMutation(api.users.setActive);
  const [error, setError] = useState<string | null>(null);

  async function handleRoleChange(userId: Id<"users">, role: Role) {
    setError(null);
    try {
      await setRole({ userId, role });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change role.");
    }
  }

  async function handleActiveChange(userId: Id<"users">, isActive: boolean) {
    setError(null);
    try {
      await setActive({ userId, isActive });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change account status.");
    }
  }

  const emailById = new Map(users?.map((u) => [u._id, u.email]));

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Users</h1>
        <Link href="/">Back to dashboard</Link>
      </header>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {users === undefined && <p>Loading…</p>}
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Email</th>
            <th style={{ textAlign: "left" }}>Name</th>
            <th style={{ textAlign: "left" }}>Role</th>
            <th style={{ textAlign: "left" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <tr key={u._id}>
              <td>{u.email}</td>
              <td>{u.name}</td>
              <td>
                <select
                  value={u.role}
                  aria-label={`Role for ${u.email}`}
                  onChange={(e) => void handleRoleChange(u._id, e.target.value as Role)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {u._id === currentUserId && <span> (you)</span>}
              </td>
              <td>
                {u.isActive ? "Active" : "Deactivated"}{" "}
                {u._id !== currentUserId && (
                  <button onClick={() => void handleActiveChange(u._id, !u.isActive)}>
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <CreateUserForm />

      <h2 style={{ marginTop: "2rem" }}>Recent changes</h2>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>When</th>
            <th style={{ textAlign: "left" }}>Who</th>
            <th style={{ textAlign: "left" }}>Action</th>
            <th style={{ textAlign: "left" }}>Details</th>
          </tr>
        </thead>
        <tbody>
          {audit?.map((a) => (
            <tr key={a._id}>
              <td>{new Date(a.at).toLocaleString()}</td>
              <td>{a.actorId ? (emailById.get(a.actorId) ?? a.actorId) : "deployment admin key"}</td>
              <td>{a.action}</td>
              <td>
                {a.targetTable === "users" && a.targetId
                  ? `${emailById.get(a.targetId as Id<"users">) ?? a.targetId} `
                  : ""}
                {a.details
                  ? Object.entries(a.details)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ")
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

// Invite-only provisioning: the admin sets a temporary password and hands it
// to the user out-of-band. New accounts start as viewer; promote afterwards.
function CreateUserForm() {
  const createUser = useAction(api.users.createUser);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreated(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    try {
      await createUser({
        email: String(data.get("email") ?? ""),
        name: name || undefined,
        temporaryPassword: String(data.get("temporaryPassword") ?? ""),
      });
      setCreated(String(data.get("email") ?? ""));
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ marginTop: "1.5rem", borderTop: "1px solid #ddd", paddingTop: "1rem" }}
    >
      <h2>Create user</h2>
      <div style={{ display: "grid", gap: "0.5rem", maxWidth: 320 }}>
        <input name="email" type="email" placeholder="Email" required />
        <input name="name" placeholder="Display name (optional)" />
        <input
          name="temporaryPassword"
          type="password"
          placeholder="Temporary password (min 8 chars)"
          required
          minLength={8}
          autoComplete="new-password"
        />
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        {created && (
          <p>
            Created {created} as viewer. Share the temporary password out-of-band, then promote
            their role above if needed.
          </p>
        )}
        <button type="submit">Create user</button>
      </div>
    </form>
  );
}
