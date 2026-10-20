import type { Metadata, Viewport } from "next";
import { Baloo_2, Mukta } from "next/font/google";
import "./globals.css";

const baloo = Baloo_2({ variable: "--font-baloo", subsets: ["latin", "devanagari"], weight: ["500", "600", "700", "800"] });
const mukta = Mukta({ variable: "--font-mukta", subsets: ["latin", "devanagari"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "MyNiyam",
  description: "Keep your daily niyams with your pathshala.",
  icons: { icon: "/brand/favicon.png", apple: "/brand/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "MyNiyam", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF1E6",
};

// Same sun-based theme rule as the landing page: Raat colours after 6:45 PM, unless the person chose.
const themeScript = `(function(){try{var t=localStorage.getItem("myniyam-theme");if(!t){var n=new Date(),h=n.getHours()+n.getMinutes()/60;t=(h>=18.75||h<6)?"night":"day"}if(t==="night")document.documentElement.setAttribute("data-theme","night")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${baloo.variable} ${mukta.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
