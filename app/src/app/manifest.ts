import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyNiyam",
    short_name: "MyNiyam",
    description: "Keep your daily niyams with your pathshala.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF1E6",
    theme_color: "#FAF1E6",
    icons: [
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
