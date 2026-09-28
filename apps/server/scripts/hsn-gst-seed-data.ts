/**
 * Seed values for the generated HSN/GST lookup sheet (ml/data/hsn-gst-lookup.xlsx).
 *
 * This is a STARTING POINT, not an authority. CBIC publishes no machine-readable HSN→rate file:
 * Notification 9/2025-CT(Rate) (effective 22 Sep 2025) lists entries at mixed granularity — tariff
 * item, sub-heading, heading OR chapter — so a code→rate map is necessarily an approximation. Every
 * row the generator writes carries a `rate_source` column saying where its number came from, and the
 * sheet is the source of truth once generated. Correct it there, not here.
 *
 * Rate structure after the 56th GST Council (effective 22 Sep 2025): the 12% slab was merged away
 * and 28% replaced by 40% for sin/luxury goods, leaving 5% and 18% as the working slabs for
 * everything this business buys.
 */

/** The slabs that actually exist after 22 Sep 2025. Replaces the stale [0, 5, 12, 18, 28]. */
export const GST_SLABS_2025 = [0, 0.25, 1.5, 3, 5, 18, 28, 40] as const;

export const RATE_EFFECTIVE_FROM = "2025-09-22";

/**
 * Chapter-level default rate. Applied to every heading in the chapter unless HEADING_RATES
 * overrides it. 18% is the standard slab and the right default for industrial goods; chapters
 * that are wholly or mostly something else are listed here.
 */
export const CHAPTER_RATES: Record<string, number> = {
  // Food, agriculture and other 5%/nil chapters this business does not buy from, but which must
  // still carry a plausible rate so the sheet is complete.
  "01": 0, "02": 5, "03": 5, "04": 5, "05": 5, "06": 5, "07": 0, "08": 5, "09": 5, "10": 0,
  "11": 5, "12": 5, "13": 5, "14": 5, "15": 5, "16": 5, "17": 5, "18": 18, "19": 5, "20": 5,
  "21": 5, "22": 18, "23": 5, "24": 40,
  // Mineral products.
  "25": 5, "26": 18, "27": 18,
  // Chemicals, plastics, rubber, leather, wood, paper, textiles.
  "28": 18, "29": 18, "30": 5, "31": 5, "32": 18, "33": 18, "34": 18, "35": 18, "36": 18,
  "37": 18, "38": 18, "39": 18, "40": 18, "41": 5, "42": 18, "43": 18, "44": 18, "45": 18,
  "46": 5, "47": 18, "48": 18, "49": 5, "50": 5, "51": 5, "52": 5, "53": 5, "54": 5, "55": 5,
  "56": 5, "57": 5, "58": 5, "59": 5, "60": 5, "61": 5, "62": 5, "63": 5, "64": 5, "65": 18,
  "66": 18, "67": 18,
  // Stone, ceramics, glass.
  "68": 18, "69": 18, "70": 18,
  // Precious metals.
  "71": 3,
  // Iron and steel. Ch.72 (primary/semi-finished: TMT bars, rods, tubes, scrap) was cut to 5% on
  // 22 Sep 2025; Ch.73 (fabricated articles — fittings, springs, fasteners, structures) stays 18%.
  "72": 5,
  "73": 18,
  // Other base metals.
  "74": 18, "75": 18, "76": 18, "78": 18, "79": 18, "80": 18, "81": 18, "82": 18, "83": 18,
  // Machinery and electrical.
  "84": 18, "85": 18,
  // Vehicles, vessels, aircraft.
  "86": 18, "87": 18, "88": 5, "89": 5,
  // Instruments, clocks, arms, furniture, toys, misc, art.
  "90": 18, "91": 18, "92": 18, "93": 18, "94": 18, "95": 18, "96": 18, "97": 18, "98": 18,
  // SAC — services. Standard rate; the real rate is service-specific and must be curated.
  "99": 18,
};

/**
 * Codes that exist in the tariff but must never be offered as a classification. They are written to
 * the sheet with active = FALSE, and flattenLeaves drops inactive nodes from every picker.
 */
export const INACTIVE_CODES = new Set([
  // HS reserves chapter 77 for future use; it has no headings, so without this it would surface as
  // a selectable leaf reading "Reserved for possible future use".
  "77",
]);

/**
 * Heading-level overrides where the chapter default is wrong. Deliberately short — every entry
 * here is one somebody has to keep correct, so only genuine exceptions belong.
 */
export const HEADING_RATES: Record<string, number> = {
  // Ch.72 defaults to 5%, but ferro-alloys and stainless flat products are standard-rated.
  "7202": 18,
  // Ch.73 defaults to 18%; household steel utensils were cut to 5% on 22 Sep 2025.
  "7323": 5,
  // Cement — 5% after the Sep 2025 rationalisation (was 28%).
  "2523": 5,
  // Coal.
  "2701": 5,
};

/**
 * Real-world trade vocabulary that does NOT appear in CBIC's tariff text, keyed by 4-digit heading.
 *
 * This is the seed of the lexicon the classifier trains on, and the reason the sheet has a
 * `trade_terms` column at all: heading 7320's official descendants say "LEAF-SPRINGS", "HELICAL
 * SPRINGS", "COIL SPRING", "SPRING PINS" and never once say "disc spring" or "Belleville washer" —
 * so no similarity search over the official text can ever match a real purchase order line.
 *
 * Seeded from item descriptions actually seen in this app's tenders, plus the two confusable pairs
 * that have already caused wrong codes in production (7307-vs-7304/7306, 7318-vs-7320). The
 * hand-written rules previously in reference-data/hsn-keyword-rules.ts are folded in here.
 */
export const TRADE_TERMS: Record<string, string[]> = {
  // --- Chapter 73: articles of iron or steel (this business's single biggest chapter) ---
  "7307": [
    "pipe fitting", "tube fitting", "socket", "reducing socket", "barrel nipple", "hex nipple",
    "elbow", "bend", "tee", "reducer", "union", "coupling", "sleeve", "cross", "plug",
    "MS fitting", "GI fitting", "IS 1239 fitting", "threaded fitting", "butt weld fitting",
    "flange", "blind flange", "slip-on flange",
  ],
  "7320": [
    "disc spring", "disc spring washer", "Belleville washer", "Belleville spring", "cup spring",
    "bearing preload spring", "preload spring", "compression spring", "tension spring",
    "torsion spring", "helical spring", "coil spring", "leaf spring", "spring washer (conical)",
    "51CrV4 spring", "DIN 2093", "DIN 17221",
  ],
  "7318": [
    "bolt", "nut", "screw", "stud", "washer", "plain washer", "flat washer", "machined washer",
    "spring lock washer", "split washer", "star washer", "rivet", "cotter pin", "split pin",
    "anchor bolt", "foundation bolt", "hex bolt", "allen bolt", "self-tapping screw",
  ],
  "7306": [
    "MS pipe", "GI pipe", "ERW pipe", "welded tube", "steel tube", "square tube", "rectangular tube",
    "hollow section", "conduit pipe",
  ],
  "7304": ["seamless pipe", "seamless tube", "boiler tube", "hydraulic tube"],
  "7308": [
    "structural steel", "steel structure", "truss", "gantry", "platform", "steel gate",
    "railing", "grating", "ladder", "walkway",
  ],
  "7312": ["wire rope", "steel wire rope", "sling", "strand", "cable (steel)"],
  "7326": ["fabricated steel article", "steel bracket", "clamp", "steel insert", "dummy bar"],
  // --- Chapter 72: primary and semi-finished steel ---
  "7214": ["TMT bar", "TMT rod", "reinforcement bar", "rebar", "deformed bar", "round bar"],
  "7208": ["HR coil", "hot rolled sheet", "hot rolled plate", "MS plate"],
  "7209": ["CR coil", "cold rolled sheet"],
  "7210": ["GP sheet", "galvanised sheet", "colour coated sheet", "PPGI"],
  // --- Chapter 39: plastics ---
  "3917": ["PVC pipe", "HDPE pipe", "CPVC pipe", "UPVC pipe", "plastic conduit", "flexible hose"],
  "3919": [
    "self adhesive tape", "PVC insulating tape", "insulation tape", "electrical tape",
    "double sided tape",
  ],
  "3926": [
    "cable tie", "nylon tie", "zip tie", "plastic clamp", "plastic spacer", "nylon bush",
    "PTFE component", "plastic washer",
  ],
  // --- Chapter 40: rubber ---
  "4016": [
    "O-ring", "oil seal", "rubber gasket", "rubber sheet", "rubber bush", "grommet",
    "FKM seal", "Viton seal", "nitrile seal", "NBR O-ring", "EPDM seal", "shore hardness",
  ],
  "4009": ["rubber hose", "hydraulic hose", "air hose", "water hose"],
  // --- Chapter 70: glass ---
  "7019": [
    "fibre glass sleeve", "fiberglass sleeve", "glass fibre tape", "glass wool", "fibreglass cloth",
    "silicone coated sleeve",
  ],
  // --- Chapter 68: stone, asbestos, friction material ---
  "6813": ["brake lining", "friction pad", "clutch facing"],
  // --- Chapter 84: machinery ---
  "8482": ["ball bearing", "roller bearing", "taper roller bearing", "needle bearing", "bearing"],
  "8483": ["gear", "gearbox", "coupling (shaft)", "pulley", "sprocket", "shaft", "bearing housing"],
  "8484": ["gasket", "precut gasket", "metalloplastic gasket", "gasket set", "mechanical seal"],
  "8481": ["valve", "ball valve", "gate valve", "globe valve", "butterfly valve", "check valve",
    "non-return valve", "safety valve", "pressure reducing valve", "solenoid valve", "cock"],
  "8413": ["pump", "centrifugal pump", "gear pump", "submersible pump", "dosing pump"],
  "8414": ["compressor", "blower", "exhaust fan", "air compressor", "vacuum pump"],
  "8421": ["filter", "filter element", "oil filter", "air filter", "strainer", "centrifuge"],
  // --- Chapter 85: electrical ---
  "8544": ["cable", "XLPE cable", "PVC cable", "armoured cable", "control cable", "flexible cable",
    "wire", "copper conductor", "power cable", "sqmm"],
  "8536": ["switch", "relay", "contactor", "MCB", "connector", "terminal block", "fuse",
    "push button", "limit switch", "lug"],
  "8537": ["control panel", "distribution board", "switchboard", "MCC panel", "PLC panel"],
  "8504": ["transformer", "rectifier", "SMPS", "power supply", "reactor", "choke", "UPS"],
  "8501": ["motor", "induction motor", "AC motor", "DC motor", "servo motor", "gear motor"],
  "8539": ["lamp", "LED light", "bulb", "flood light", "street light", "tube light", "fitting"],
  // --- Chapter 90: instruments ---
  "9026": ["pressure gauge", "flow meter", "level transmitter", "pressure transmitter", "manometer"],
  "9027": ["analyser", "gas analyser", "spectrometer"],
  "9032": ["controller", "temperature controller", "PID controller", "thermostat"],
  "9025": ["thermometer", "thermocouple", "RTD", "pyrometer", "temperature sensor"],
  // --- Chapter 82/83: tools and misc base metal ---
  "8207": ["drill bit", "cutting tool", "insert", "tap", "die", "reamer", "milling cutter"],
  "8205": ["hand tool", "spanner", "wrench", "hammer", "chisel", "plier"],
  "8311": ["welding electrode", "welding rod", "filler wire", "flux cored wire"],
};
