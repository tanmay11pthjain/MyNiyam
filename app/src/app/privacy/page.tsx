import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy · MyNiyam" };

// PLACEHOLDER TEXT. Replace with the reviewed privacy notice (DPDP Act 2023) before launch.
export default function Page() {
  return (
    <div className="frame">
      <header className="bar"><Link href="/" className="logo" aria-label="MyNiyam home"><img src="/brand/wordmark.png" alt="MyNiyam" width={880} height={188} /></Link></header>
      <main className="screen prose">
        <h1>Privacy notice</h1>
        <p className="pill kesar" style={{ justifySelf: "start" }}>Draft: placeholder text</p>
        <h2>What we keep</h2>
        <p>Your mobile number, the pathshala you joined, and for each person on your number: their name, class and the answers your pathshala asks for. Date of birth, photo and location are asked only if your pathshala turns them on.</p>
        <h2>Why</h2>
        <p>To log you in, to show your pathshala who is keeping which niyam, and nothing else. No ads, and we never sell data.</p>
        <h2>Children</h2>
        <p>A child&apos;s profile is added by a parent or guardian on their own number, with their consent.</p>
        <h2>Your choices</h2>
        <p>Ask your pathshala admin to remove your number. That deletes every profile on it.</p>
        <h2 lang="hi">हिंदी में</h2>
        <p lang="hi">हम आपका मोबाइल नंबर, पाठशाला, और हर व्यक्ति का नाम, कक्षा और पाठशाला के सवालों के जवाब रखते हैं। जन्म तिथि, फ़ोटो और जगह तभी पूछी जाती है जब पाठशाला चालू करे। बच्चे की प्रोफ़ाइल माता-पिता अपनी सहमति से जोड़ते हैं। हम डेटा कभी नहीं बेचते।</p>
        <p className="mt-5"><Link href="/join">Back to joining</Link></p>
      </main>
    </div>
  );
}
