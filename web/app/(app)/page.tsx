"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/components/app-provider";
import { homeFor } from "@/lib/api";

export default function Home() {
  const { me } = useApp();
  const router = useRouter();
  useEffect(() => router.replace(homeFor(me.role)), [me.role, router]);
  return null;
}
