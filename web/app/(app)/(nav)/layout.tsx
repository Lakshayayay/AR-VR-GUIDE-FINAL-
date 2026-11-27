import { TabBar, TopNav } from "@/components/top-nav";

export default function NavLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      {children}
      <TabBar />
    </>
  );
}
