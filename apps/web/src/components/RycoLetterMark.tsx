import { cn } from "~/lib/utils";

/**
 * The Ryco "R" mark, from `assets/logo_letter_only.svg`.
 *
 * Two departures from the source art, both deliberate:
 *
 * - The viewBox is re-cut tight around the glyph. The source floats the letter
 *   inside a square canvas roughly three times its size, so its own box would
 *   render the mark at a third of the requested height.
 * - The hardcoded `rgb(21,21,21)` fill becomes `currentColor`, so the mark
 *   takes the surrounding text colour — near-black on light surfaces,
 *   near-white on dark — instead of vanishing into a dark background.
 *
 * Decorative: every surface that renders it already labels itself (the sidebar
 * brand link, the boot surface's `role="status"` region), so a second
 * accessible name here would only add noise.
 *
 * Pass the height through `className`; width follows the glyph's aspect ratio.
 */
export function RycoLetterMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("w-auto shrink-0", className)}
      viewBox="414.46 386.67 425.09 480.61"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <g transform="matrix(0.125617,0,0,-0.125617,-180.839814,1610.932617)">
        <path d="M6035,9744C5514,9700 5112,9433 4886,8982C4838,8886 4786,8729 4764,8610L4746,8515L4742,7231L4739,5947L4758,5928L4796,5962C4818,5981 4975,6121 5147,6273L5459,6550L5462,7502L5465,8455L5491,8532C5576,8779 5754,8952 6002,9028L6055,9044L6605,9048C6908,9050 7178,9049 7206,9045L7258,9039L7364,8975L7392,8930C7407,8905 7424,8863 7429,8835L7438,8786L7429,8725C7424,8692 7406,8636 7389,8601L7358,8538L7295,8474L7233,8411L7161,8376L7088,8341L7032,8335C6708,8298 6509,8207 6296,7996C6187,7889 6155,7846 5901,7472L5708,7188L5714,7167C5717,7155 5741,7123 5768,7095C5794,7068 5840,7016 5870,6980C5919,6922 6037,6786 6370,6405C6428,6340 6528,6225 6594,6150C6659,6076 6732,5994 6757,5968L6801,5920L7710,5920L7710,5933C7710,5939 7666,5997 7612,6061C7503,6191 7498,6197 7009,6774C6599,7259 6590,7270 6590,7283C6590,7305 6683,7421 6753,7486L6827,7555L6975,7629L7040,7640C7076,7646 7148,7659 7200,7670C7628,7751 8003,8123 8102,8563L8123,8655L8122,8795L8122,8935L8097,9030C8048,9217 7971,9350 7832,9482C7695,9612 7569,9680 7385,9723L7295,9743L6685,9745C6350,9746 6057,9746 6035,9744Z" />
      </g>
    </svg>
  );
}
