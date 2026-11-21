import { AppProvider } from "@/components/app-provider";

export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}
