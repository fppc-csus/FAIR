import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "FAIR | Financial Accountability & Interest Review" },
    { name: "description", content: "Explore potential overlaps between California public officials’ financial disclosures and local government agenda items." },
  ];
}

export default function Home() {
  return <Welcome />;
}