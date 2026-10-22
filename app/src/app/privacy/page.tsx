import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy · MyNiyam" };
// The grievance contact comes from the GRIEVANCE_* env vars, read when the site is built (redeploy after changing them).

// DRAFT. Written to the DPDP Act 2023 and Rules 2025; a lawyer must review it before public launch.
export default function Page() {
  const name = process.env.GRIEVANCE_NAME || "Tanmay Dhelariya";
  const email = process.env.GRIEVANCE_EMAIL || "";
  const phone = process.env.GRIEVANCE_PHONE || "";
  return (
    <div className="frame">
      {/* "/" is the static landing page, so a full page load. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <header className="bar"><a href="/" className="logo" aria-label="MyNiyam home"><img src="/brand/wordmark.png" alt="MyNiyam" width={880} height={188} /></a></header>
      <main className="screen prose">
        <h1>Privacy notice</h1>
        <p className="pill kesar" style={{ alignSelf: "flex-start" }}>Draft: being checked by a lawyer</p>
        <p>MyNiyam helps your pathshala see which niyams its members keep. This page says, in plain words, what we keep, why, and what you can do about it.</p>

        <h2>What we keep</h2>
        <ul>
          <li>Your mobile number, and the pathshala you joined.</li>
          <li>For each person on your number: name, class, and the answers your pathshala asks for. Date of birth, photo and location are asked only if your pathshala turns them on.</li>
          <li>The niyams each person logs, and on which day.</li>
        </ul>

        <h2>Why we keep it</h2>
        <p>To log you in, to show you your own progress, and to show your pathshala&apos;s admins and teachers who is keeping which niyam. Nothing else. There are no ads, we do not track or profile anyone, and we never sell or share data.</p>

        <h2>Who can see it</h2>
        <p>You, and your own pathshala&apos;s admins and the teachers they allow. Nobody in another pathshala. Your data is stored in India.</p>

        <h2>Children</h2>
        <p>Anyone under 18 is a child under the law. A child&apos;s profile is added only by a parent or guardian, on their own verified number, with their consent.</p>

        <h2>Your rights</h2>
        <ul>
          <li><b>See and correct:</b> open Profile, then &ldquo;Edit my details&rdquo;.</li>
          <li><b>Get a copy:</b> open Profile, then &ldquo;Download my data&rdquo;.</li>
          <li><b>Delete:</b> open Profile, then &ldquo;Delete my data&rdquo;. This deletes your number, everyone on it and all their logs at once. You can also ask your pathshala admin to do it.</li>
          <li><b>Withdraw consent:</b> deleting your data withdraws it. When a pathshala removes a family, its data is deleted after 30 days.</li>
        </ul>

        <h2>Questions or complaints</h2>
        <p>Contact {name}{email && <>, <a href={`mailto:${email}`}>{email}</a></>}{phone && <>, <a href={`tel:${phone}`}>{phone}</a></>}. If you are not happy with our answer, you can complain to the Data Protection Board of India.</p>

        <h2 lang="hi">हिंदी में</h2>
        <div lang="hi" className="stack">
          <p><b>हम क्या रखते हैं:</b> आपका मोबाइल नंबर, आपकी पाठशाला, और हर व्यक्ति का नाम, कक्षा, पाठशाला के सवालों के जवाब और रोज़ के नियम। जन्म तिथि, फ़ोटो और जगह तभी पूछी जाती है जब पाठशाला चालू करे।</p>
          <p><b>क्यों:</b> लॉग इन के लिए, आपकी प्रगति दिखाने के लिए, और आपकी पाठशाला को दिखाने के लिए कि कौन कौन से नियम पाल रहा है। कोई विज्ञापन नहीं, कोई ट्रैकिंग नहीं, डेटा कभी बेचा नहीं जाता।</p>
          <p><b>कौन देख सकता है:</b> आप, और आपकी पाठशाला के एडमिन और शिक्षक। डेटा भारत में रखा जाता है।</p>
          <p><b>बच्चे:</b> 18 साल से कम उम्र के बच्चे की प्रोफ़ाइल माता-पिता अपने नंबर से, अपनी सहमति से जोड़ते हैं।</p>
          <p><b>आपके अधिकार:</b> प्रोफ़ाइल में जाकर अपनी जानकारी बदलें, &ldquo;Download my data&rdquo; से कॉपी लें, और &ldquo;Delete my data&rdquo; से सब कुछ तुरंत मिटाएँ।</p>
          <p><b>शिकायत:</b> {name}{email && <> ({email})</>} से संपर्क करें।</p>
        </div>
        <p className="mt-5"><Link href="/home">Back to MyNiyam</Link></p>
      </main>
    </div>
  );
}
