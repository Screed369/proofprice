/** Plain questions shown on /method and repeated as FAQPage JSON-LD. Keep in step with the method bullets on the page. */
export const METHOD_FAQ = [
  {
    question: "How does ProofPrice turn records into a price?",
    answer:
      "Most answers are a range: the median and the 10th to 90th percentile of recorded prices, with the sample size, period and a confidence label. Official statistics are the exception: we pass on the publisher's own figure.",
  },
  {
    question: "What do the confidence labels mean?",
    answer: "High means 50 or more records, medium means 15 to 49, and low means 5 to 14. Below 5 records ProofPrice does not publish a figure.",
  },
  {
    question: "Does ProofPrice return individual addresses or purchases?",
    answer: "No. For home sales and purchases only aggregates are returned, never individual addresses or personal data.",
  },
];
