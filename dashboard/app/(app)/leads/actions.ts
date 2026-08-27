"use server";
import { revalidatePath } from "next/cache";
import { updateLeadStatus } from "../../../lib/api";

export async function setLeadStatus(formData: FormData) {
  const leadId = String(formData.get("leadId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!leadId || !status) return;
  await updateLeadStatus(leadId, status);
  revalidatePath("/leads");
}
