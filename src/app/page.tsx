import { redirect } from "next/navigation";

/** Projects is Aidub's entry point; there is no marketing homepage. */
export default function RootPage() {
  redirect("/projects");
}
