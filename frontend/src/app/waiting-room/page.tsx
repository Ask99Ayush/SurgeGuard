import type { Metadata } from "next";
import { WaitingRoom } from "@/components/waiting-room/WaitingRoom";

export const metadata: Metadata = { title: "Waiting room" };

export default function WaitingRoomPage() {
  return <WaitingRoom />;
}
