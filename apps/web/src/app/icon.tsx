import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Mirrors the "BM·P" wordmark in Sidebar, in the theme's steel-blue primary
// with the amber signal color as the separator dot.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1E4B8F",
          borderRadius: 6,
          color: "#F1F5F9",
          fontSize: 15,
          fontWeight: 600,
          fontFamily: "monospace",
          letterSpacing: -0.5,
        }}
      >
        BM<span style={{ color: "#DB7706" }}>&middot;</span>P
      </div>
    ),
    size,
  );
}
