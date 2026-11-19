const H2 = "text-2xl font-semibold text-slate-900";
const P = "leading-7 text-slate-700";

export function meta() {
  return [{ title: "Methodology | FAIR Investigations" }];
}

const RULES: [string, string, string][] = [
  ["A-1 investments", "Business entity named in the agenda text", "Fair market value of $2,000 or more · §87103(a)"],
  ["A-2 business entities", "Entity named; also the entity's own sources of income of $10,000+ and its investments", "Business position or investment · §87103(a), (c), (d)"],
  ["B real property", "Street address or APN in the agenda text (a city name alone is not enough)", "§87103(b); within 500 ft is presumed material"],
  ["C income", "Source of income named; also tenants and commission sources listed on B and C", "$500 or more in the prior 12 months · §87103(c). Government salary is excluded (§82030(b)(2)); commercial lenders are not matched"],
  ["D gifts", "Donor named; gifts from one donor on a statement are added together", "At or above the gift limit for the decision year ($500 in 2019–20, $630 in 2025–26) · §87103(e)"],
  ["E travel", "Payer named", "At or above $500 or the gift limit, whichever is lower"],
];

export default function About() {
  return (
  <main className="mx-auto max-w-4xl space-y-10 px-6 py-12">
    <header className="space-y-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Methodology</p>
      <h1 className="text-4xl font-bold tracking-tight text-slate-900">How FAIR finds candidate conflicts</h1>
      <p className="text-lg leading-8 text-slate-700">FAIR (Financial Accountability &amp; Interest Review) compares California Form 700 Statements of Economic Interests with local agenda items and surfaces <strong>candidates</strong> for investigator review. A flag is a lead. It is not a determination that the Political Reform Act was violated.</p>
    </header>

    <section className="space-y-3">
      <h2 className={H2}>Data sources</h2>
      <p className={P}><strong>Form 700 filings</strong> are uploaded as NetFile XLSX exports or individual PDFs. Every column of every schedule row is kept, including addresses, business activity, acquisition and disposal dates, tenants, lenders, gift descriptions and travel destinations. When a filer submitted amendments, each schedule comes from the newest submission that contains it, so schedules the amendment did not re-file are carried forward.</p>
      <p className={P}><strong>Agenda items</strong> come from Legistar (title, notes, minutes and the full matter text: staff report and recommended action) and from PDF agendas located by the Apify crawler. Grantee and vendor names often appear only in the recommended action. For example, Sonoma County file 2019-1709 names “LandPaths, $20,000” only there.</p>
    </section>

    <section className="space-y-3">
      <h2 className={H2}>Which filings apply to a meeting</h2>
      <p className={P}>A filing is compared with meetings in the <strong>same jurisdiction</strong> (spelling variants such as “County of Sonoma” and “Sonoma County” are the same) held in the filing year or the following year. This reflects the 12-month look-back for income and gifts. Administrators can change the window with <code>FAIR_FILING_PERIOD_OFFSETS</code>. Filers created by an import are matched immediately and marked <em>identity unverified</em> until an owner confirms them on Identity review.</p>
    </section>

    <section className="space-y-3">
      <h2 className={H2}>Matching rules</h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Schedule</th><th className="p-3">What must appear</th><th className="p-3">Threshold / authority</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{RULES.map(([schedule, match, threshold]) => <tr key={schedule}><td className="p-3 font-semibold">{schedule}</td><td className="p-3">{match}</td><td className="p-3">{threshold}</td></tr>)}</tbody></table></div>
      <p className={P}>Names are compared after normalising case, punctuation and legal suffixes (Inc., LLC). An exact phrase anywhere in the item scores 1.0 and matches. Multi-word names may also match approximately: 0.90 or higher matches automatically, and 0.70–0.89 is sent to an optional AI check. Single-word names must appear exactly. Severity follows the reported value: High from $10,000, Medium from $1,000, otherwise Low.</p>
    </section>

    <section className="space-y-3">
      <h2 className={H2}>What an investigator still has to establish</h2>
      <ul className="list-disc space-y-2 pl-6 text-slate-700">
        <li>That the official made, participated in or influenced the decision, and did not recuse.</li>
        <li>That the interest existed during the 12 months before the decision; Form 700 reporting periods do not always align with meeting dates.</li>
        <li>That the decision's effect on the interest is reasonably foreseeable and material (2 CCR §18700 et seq.), and whether an exception such as the public generally applies.</li>
        <li>That the entity in the agenda is the same entity as the one disclosed (same-name organizations exist).</li>
      </ul>
      <p className={P}>Record what you verified in the review note on each conflict. Every decision is kept in the review history.</p>
    </section>

    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-6">
      <h2 className="text-2xl font-semibold text-slate-900">
        FPPC contact information
      </h2>

      <p className="leading-7 text-slate-700">
        The California Fair Political Practices Commission provides official
        guidance about California’s Political Reform Act and Form 700
        requirements.
      </p>

      <div className="space-y-5 text-slate-700">
        <div>
          <h3 className="font-semibold text-slate-900">
            General information
          </h3>
          <p>
            <a
              href="tel:9163225660"
              className="text-blue-700 underline hover:text-blue-900"
            >
              (916) 322-5660
            </a>
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Political Reform Act advice
          </h3>
          <p>
            <a
              href="tel:18662753772"
              className="text-blue-700 underline hover:text-blue-900"
            >
              1-866-ASK-FPPC (866) 275-3772, option 1
            </a>
          </p>
          <p>
            <a
              href="mailto:advice@fppc.ca.gov"
              className="text-blue-700 underline hover:text-blue-900"
            >
              advice@fppc.ca.gov
            </a>
          </p>
          <p className="text-sm text-slate-600">
            Advice is available Monday through Thursday, 9:00 a.m. to 11:30
            a.m.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Public record requests
          </h3>
          <p>
            Phone:{" "}
            <a
              href="tel:9164452772"
              className="text-blue-700 underline hover:text-blue-900"
            >
              (916) 445-2772
            </a>
          </p>
          <p>
            Email:{" "}
            <a
              href="mailto:cpra@fppc.ca.gov"
              className="text-blue-700 underline hover:text-blue-900"
            >
              cpra@fppc.ca.gov
            </a>
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Form 700 requests
          </h3>
          <p>
            <a
              href="tel:18662753772"
              className="text-blue-700 underline hover:text-blue-900"
            >
              1-866-ASK-FPPC (866) 275-3772, option 2
            </a>
          </p>
          <p>
            <a
              href="mailto:form700@fppc.ca.gov"
              className="text-blue-700 underline hover:text-blue-900"
            >
              form700@fppc.ca.gov
            </a>
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Enforcement
          </h3>
          <p>
            <a
              href="mailto:intake@fppc.ca.gov"
              className="text-blue-700 underline hover:text-blue-900"
            >
              intake@fppc.ca.gov
            </a>
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Agenda comments
          </h3>
          <p>
            <a
              href="mailto:commasst@fppc.ca.gov"
              className="text-blue-700 underline hover:text-blue-900"
            >
              commasst@fppc.ca.gov
            </a>
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Website comments and suggestions
          </h3>
          <p>
            <a
              href="mailto:webmaster@fppc.ca.gov"
              className="text-blue-700 underline hover:text-blue-900"
            >
              webmaster@fppc.ca.gov
            </a>
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Media inquiries
          </h3>
          <p>
            Phone:{" "}
            <a
              href="tel:9163227761"
              className="text-blue-700 underline hover:text-blue-900"
            >
              (916) 322-7761
            </a>
          </p>
          <p>
            Email:{" "}
            <a
              href="mailto:press@fppc.ca.gov"
              className="text-blue-700 underline hover:text-blue-900"
            >
              press@fppc.ca.gov
            </a>
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Speaker requests
          </h3>
          <p>
            <a
              href="tel:9163278269"
              className="text-blue-700 underline hover:text-blue-900"
            >
              (916) 327-8269
            </a>
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">
            Other FPPC information
          </h3>
          <p>
            Fax for general information and public record requests:{" "}
            <a
              href="tel:9163220886"
              className="text-blue-700 underline hover:text-blue-900"
            >
              (916) 322-0886
            </a>
          </p>
          <p>
            FPPC Electronic Filing System:{" "}
            <a
              href="mailto:form700@fppc.ca.gov"
              className="text-blue-700 underline hover:text-blue-900"
            >
              form700@fppc.ca.gov
            </a>
          </p>
        </div>

        <p className="pt-2">
          <a
            href="https://www.fppc.ca.gov/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-700 underline hover:text-blue-900"
          >
            Visit the official FPPC website
          </a>
        </p>
      </div>
    </section>
  </main>
);
}