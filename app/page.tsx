import { redirect } from "next/navigation";
export default function Home() {
  redirect(
    process.env.NEXT_PUBLIC_DEMO_MODE === "1"
      ? "/dashboard?sample=1"
      : "/login",
  );
}
