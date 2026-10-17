"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/session";

const RoleContext = createContext<Role>("viewer");

export const RoleProvider = RoleContext.Provider;

/** True for the read-only demo account. Actions are also refused server-side (403). */
export function useReadOnly(): boolean {
  return useContext(RoleContext) !== "admin";
}
