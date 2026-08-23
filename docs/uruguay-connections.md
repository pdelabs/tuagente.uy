# What systems a Uruguayan SMB works with (and how we plug into them)

Survey to decide which connections to build first. **Status: 2026-08-05.**

Reading rule: where it says *verified* I confirmed it against the source;
everything else is judgment and needs checking before promising it to a
client.

---

## 1. Electronic invoicing (CFE) — the only mandatory one

Every company that invoices in Uruguay issues a CFE to the DGI. It's the one
system **no SMB can escape**, and that's why it's the most valuable to
connect to: that's where the sale, the client and the date all live.

- **Uruware** — the dominant one: more than **25,000 companies** in Uruguay
  (*verified*).
- The DGI has **77 authorized providers** (*verified*), including
  **Memory**, **Zureo**, **Bantotal**, **GeoFactura**, **Mempyme**,
  **Facture**.
- The CFE model is XML over web services by design, so almost all of them
  expose some integration path. **Still needs case-by-case verification**
  of whether it's an open API or something only enabled for partners.

**How to connect it:** one skill of ours per provider, with the client's own
credentials. Start with Uruware for volume, then look at Zureo/Memory.

**What it enables, in plain terms:** "avisame cuando un cliente no pagó a
los 30 días", "cuánto facturamos este mes contra el pasado", "armá el
resumen para el contador". That's what an SMB asks for every month.

---

## 2. Accounting and management

**Memory** is probably the most installed one in accounting firms and small
shops; **Zureo** and **Facture** compete as lightweight ERPs; bigger
companies go with **Bantotal** or SAP/Dynamics.

Reality to accept: a lot of SMBs keep their books **in spreadsheets**, and
the accounting firm gets everything by mail. That's why Google Sheets +
email cover more real cases than any ERP.

---

## 3. Payments, POS and gateways

The sector with the **best public APIs** in the country.

- **Mercado Pago** — the payment gateway most used by Uruguayan sellers
  (*verified*). Public API, documented, with a sandbox. **The easiest of
  all.**
- **Handy** — Uruguayan POS with **public integration guides** and a
  WooCommerce plugin (*verified*). Integrates via **Plexo**.
- **Plexo** — a gateway that aggregates acquirers: Getnet, OCA, Fiserv,
  Totalnet and Scanntech (*verified*). Connecting Plexo gets you several at
  once.
- **Scanntech** — strong in retail and self-service, 30 years in POS
  (*verified*).

**High priority:** Mercado Pago first (open API, high volume, zero red
tape), then Plexo for the leverage effect.

---

## 4. Banks

Santander, Itaú, BROU, Scotiabank, BBVA. **Uruguay has no mandatory open
banking**, so there's no API for an SMB: the statement gets downloaded by
hand.

**How we solve this today:** the client uploads the statement to the portal
(already works, it lands in `workspace/entrada/`) and the agent reconciles
it against invoices. It's not elegant and **it's exactly what a person does
by hand today**, so the value is the same.

**What we're NOT going to do:** store the client's homebanking credentials
to log in on their behalf. The risk doesn't pay off, and it's the kind of
thing that gets you sued.

---

## 5. Online stores

**Tiendanube** (very common in the region), **Shopify**, **WooCommerce**
and **Mercado Libre**. All four have a public API and OAuth. Medium-difficulty
connection, high value for anyone who sells online: stock, orders and
unanswered questions.

---

## 6. What everyone already uses every day

- **WhatsApp** — the real channel of Uruguayan commerce. The most expensive
  one to connect properly (Meta business verification, takes days). Worth
  it anyway.
- **Google Workspace** — mail, spreadsheets, Drive. **Already supported by
  the engine**; what's missing is our own OAuth app so the client doesn't
  have to create one.
- **Microsoft 365** — fairly common in more formal companies. Not
  evaluated yet.
- **Own-domain email** — IMAP/SMTP, minutes, no paperwork. The cheapest of
  all and often the most useful.

---

## 7. Government (DGI, BPS)

DGI and BPS have online services with a certificate, built for the taxpayer
or their accountant, **not for a third party to integrate with**. There's no
open API for an agent to act on the company's behalf.

**Stance:** don't automate filings with the government. The agent prepares
and notifies; the person files. It's also the most defensible position if
something goes wrong.

---

## Where to start

Ordered by (how many people use it) × (how easy it is) × (how much it hurts
today):

| # | Connection | Why |
|---|---|---|
| 1 | **Own-domain email** | Minutes, zero paperwork, fixes "nobody answered me" |
| 2 | **Google Sheets / Drive** | Already supported; just needs our own OAuth app |
| 3 | **Mercado Pago** | Open, documented API, high volume |
| 4 | **Electronic invoicing (Uruware)** | The highest real value; the most work |
| 5 | **Official WhatsApp** | High value, long paperwork: start early |
| 6 | **Tiendanube / Mercado Libre** | Only for clients that sell online |

The first three can be up and running without depending on anyone external.

---

## What needs verifying before selling any of these

1. Whether Uruware gives API access to an integrator or only to its direct
   client.
2. What permissions Plexo actually asks for and whether there's a test
   environment.
3. Whether Tiendanube requires publishing an app on its marketplace.
4. How long WhatsApp's business verification really takes in Uruguay.

## Sources

- [Registro de proveedores habilitados — DGI](https://www.efactura.dgi.gub.uy/principal/factura-electronica-registro-de-proveedores-habilitado)
- [Uruware](https://www.uruware.com/)
- [Proveedores autorizados por la DGI — Memory](https://memory.com.uy/blog-general/proveedores-de-facturacion-autorizados-por-la-dgi/)
- [Handy — guías de integración](https://handy.uy/guias-de-integracion/)
- [Plexo](https://www.plexo.com.uy/)
- [Mercado Pago Uruguay — guía](https://tiendli.com/blog/mercadopago-uruguay-guia)
- [Acuerdo Scanntech — BBVA Uruguay](https://www.bbva.com.uy/empresas/acuerdo-scanntech.html)


---

## Electronic invoicing: the open question, answered (8/9/2026)

The question was *"whether Uruware gives API access to an integrator or
only to partners."* **Neither one: the credentials belong to the CLIENT,
not to us.**

- The integration happens through **inbound channels** (web service,
  database or file exchange) or through programmable components (.NET,
  Java, ActiveX).
- The credentials —username, password, **merchant code**, **terminal
  code** and URL— are handed over by **Uruware's own operations department
  to the client** who contracted the service.
- **No partner agreement is needed on our side at all.** It's the same
  model as email or Mercado Pago: the client already has the relationship,
  we use their credentials.

**What does need asking of each client:** whether their plan includes
integration. Uruware provides documentation and technical support *"si el
cliente contrata un plan para integrar un sistema de facturación"* — a
portal-only plan might not be enough. That's a question for onboarding, not
an assumption.

**The real cost:** UCFE is SOAP/XML, not REST. Considerably more work than
Mercado Pago. There's a public PHP client (`planetadeleste/ucfe`) that
serves as a reference, and the manual can be downloaded from
`portal.mifactura.com.uy`.

### And it isn't one connector, it's several

The DGI has 77 authorized providers and **each one exposes its own thing**.
A concrete example found the same day: **Surtec**
(`facturaelectronica.com.uy`) has a **REST API with public documentation and
Bearer token** — create CFEs, look up issued ones and look up received
ones. Much cheaper to build than UCFE.

**Conclusion:** "connecting electronic invoicing" isn't one connector, it's
a pattern with a provider plugged into it. Worth building the shape once and
starting with **whichever provider the first client who asks for it uses** —
not the biggest one. Guessing which one that'll be is throwing work away.
