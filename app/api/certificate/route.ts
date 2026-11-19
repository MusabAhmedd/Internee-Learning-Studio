import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { dashboardFor } from "@/lib/dashboard";
import { localDate } from "@/lib/learning-dates";
import { authenticated, HttpError } from "@/lib/http";
export const GET = authenticated(async (_request, claims) => {
  const { board, profile, done } = await dashboardFor(claims.uid);
  if (!board.certificateAvailable)
    throw new HttpError(
      409,
      "TRACK_INCOMPLETE",
      "Finish every lesson in your track to download your certificate.",
    );
  const pdf = await PDFDocument.create();
  pdf.setTitle("Learning Studio - Completion Certificate");
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  try {
    font.encodeText(profile.displayName);
  } catch {
    throw new HttpError(
      422,
      "CERTIFICATE_NAME",
      "The current certificate font requires a Latin-script display name. Update your learning profile and retry.",
    );
  }
  const page = pdf.addPage([720, 510]);
  const ink = rgb(0.12, 0.12, 0.24);
  const violet = rgb(0.28, 0.19, 0.58);
  const soft = rgb(0.33, 0.34, 0.49);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 720,
    height: 510,
    color: rgb(0.96, 0.95, 1),
  });
  page.drawRectangle({
    x: 28,
    y: 28,
    width: 664,
    height: 454,
    borderColor: violet,
    borderWidth: 1.3,
  });
  page.drawRectangle({
    x: 37,
    y: 37,
    width: 646,
    height: 436,
    borderColor: rgb(0.77, 0.72, 0.94),
    borderWidth: 0.7,
  });
  const line = (
    content: string,
    y: number,
    size: number,
    bold = false,
    color = ink,
  ) => {
    const current = bold ? font : regular;
    const fitted = Math.min(
      size,
      (size * 590) / Math.max(1, current.widthOfTextAtSize(content, size)),
    );
    page.drawText(content, {
      font: current,
      size: fitted,
      x: (720 - current.widthOfTextAtSize(content, fitted)) / 2,
      y,
      color,
    });
  };
  line(
    board.sample ? "SAMPLE  /  LEARNING STUDIO" : "LEARNING STUDIO",
    401,
    13,
    true,
    violet,
  );
  line("Certificate of Completion", 342, 33, true);
  line("This recognizes", 292, 14, false, soft);
  line(profile.displayName, 241, 35, true, violet);
  line(`for completing the ${profile.track} learning track`, 196, 15, false);
  line(`${board.completed} lessons completed`, 169, 13, false, soft);
  const completedAt = done
    .flatMap((mark) => (mark.completedAt ? [mark.completedAt] : []))
    .sort()
    .at(-1);
  if (completedAt)
    line(
      `Completed ${localDate(completedAt, profile.timeZone)} (${profile.timeZone})`,
      111,
      12,
      true,
    );
  line(
    board.sample
      ? "Sample training artifact - not an official Internee.pk credential."
      : "Issued by this Learning Studio instance.",
    73,
    10,
    false,
    soft,
  );
  return new Response(new Uint8Array(await pdf.save()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        'attachment; filename="learning-studio-certificate.pdf"',
      "Cache-Control": "no-store",
    },
  });
});
