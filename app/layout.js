import "./globals.css";

export const metadata = {
  title: "Last Z War Room Elite",
  description: "Elite planning board for Last Z Survival Canyon Clash",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
