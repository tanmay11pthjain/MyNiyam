import { NextResponse, type NextRequest } from "next/server";

// The old CSV link: the report is now an Excel file (GET /api/admin/reports/excel).
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL(`/api/admin/reports/excel${req.nextUrl.search}`, req.url), 308);
}
