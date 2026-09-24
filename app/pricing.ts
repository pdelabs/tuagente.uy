/* The price the public site publishes, in one place.
 *
 * The model decided by Luis on 2026-09-24: the monthly, with no setup fee,
 * already carries the agent and its WhatsApp and Instagram replies; every job
 * added on top joins the monthly at a price that is quoted (free) and never
 * published; custom work is paid once and half of it comes back as a discount
 * on the monthly. The landing, the blog's CTA and the two web bots read it
 * from here, so a bot never keeps quoting a number the page stopped showing.
 * The pricing blog post quotes it in prose — change that one by hand. */

export const MONTHLY_USD = "90";

export const MONTHLY = `USD ${MONTHLY_USD}`;

/** The guarantee, word for word wherever it shows. */
export const GUARANTEE = "Si el primer mes no hizo lo que te dijimos, ese mes no lo pagás.";
