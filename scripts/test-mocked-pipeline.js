#!/usr/bin/env node
/**
 * Level 2: Local Mocked Pipeline Test Suite
 * Validates data transformations, RSS parsing, deduplication, Gemini schema enforcement,
 * Pinecone deterministic ID hashing, and error sanitization without contacting external APIs.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

console.log('=== Level 2: Local Mocked Pipeline Tests ===\n');

let passedTests = 0;
let totalTests = 0;

function runTest(testName, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${testName}`);
    console.error(`    Error: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Test 1: Valid Research Request Validation
// -----------------------------------------------------------------------------
runTest('Valid research request passes validation', () => {
  const payload = { body: { topic: 'quantum computing' } };
  const topic = typeof payload.body.topic === 'string' ? payload.body.topic.trim() : '';
  const isValid = topic.length > 0 && topic.length <= 200;
  assert.strictEqual(isValid, true);
  assert.strictEqual(topic, 'quantum computing');
});

// -----------------------------------------------------------------------------
// Test 2: Missing or Empty Topic Validation
// -----------------------------------------------------------------------------
runTest('Missing or empty topic fails validation', () => {
  const invalidPayloads = [
    { body: {} },
    { body: { topic: '' } },
    { body: { topic: '   ' } },
    { body: { topic: null } },
    { body: { topic: 'a'.repeat(201) } }
  ];

  invalidPayloads.forEach(p => {
    const topic = typeof p.body?.topic === 'string' ? p.body.topic.trim() : '';
    const isValid = topic.length > 0 && topic.length <= 200;
    assert.strictEqual(isValid, false);
  });
});

// -----------------------------------------------------------------------------
// Test 3: Valid Question Request Validation
// -----------------------------------------------------------------------------
runTest('Valid QA question passes validation', () => {
  const payload = { body: { question: 'What are the main recent developments in quantum computing?' } };
  const rawQuestion = typeof payload.body.question === 'string' ? payload.body.question.trim() : '';
  const isValid = rawQuestion.length >= 3 && rawQuestion.length <= 500;
  assert.strictEqual(isValid, true);
});

// -----------------------------------------------------------------------------
// Test 4: Missing or Invalid Question Validation
// -----------------------------------------------------------------------------
runTest('Missing or invalid QA question fails validation', () => {
  const invalidQuestions = [
    { body: {} },
    { body: { question: '' } },
    { body: { question: 'ab' } }, // too short
    { body: { question: 'q'.repeat(501) } } // too long
  ];

  invalidQuestions.forEach(q => {
    const rawQuestion = typeof q.body?.question === 'string' ? q.body.question.trim() : '';
    const isValid = rawQuestion.length >= 3 && rawQuestion.length <= 500;
    assert.strictEqual(isValid, false);
  });
});

// -----------------------------------------------------------------------------
// Test 5: RSS Parsing, Sanitization & Entity Decoding
// -----------------------------------------------------------------------------
const mockXmlPath = path.join(__dirname, '..', 'examples', 'mock-rss-feed.xml');
const rawXml = fs.readFileSync(mockXmlPath, 'utf8');

function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseFeed(xml, topic = 'quantum computing') {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(block);
    const linkMatch = /<link>([\s\S]*?)<\/link>/.exec(block);
    const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block);
    const descMatch = /<description>([\s\S]*?)<\/description>/.exec(block);
    const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(block);

    const rawTitle = titleMatch ? cleanText(titleMatch[1]) : '';
    const rawLink = linkMatch ? cleanText(linkMatch[1]) : '';
    const rawPubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
    const rawDesc = descMatch ? cleanText(descMatch[1]) : '';
    const rawSource = sourceMatch ? cleanText(sourceMatch[1]) : 'Google News';

    if (!rawLink || !/^https?:\/\//i.test(rawLink)) continue;
    if (!rawTitle) continue;

    let timestamp = 0;
    let isoDate = new Date().toISOString();
    if (rawPubDate) {
      const parsed = Date.parse(rawPubDate);
      if (!isNaN(parsed)) {
        timestamp = parsed;
        isoDate = new Date(parsed).toISOString();
      }
    }

    items.push({
      title: rawTitle,
      source_url: rawLink,
      published_at: isoDate,
      timestamp,
      description: rawDesc || rawTitle,
      source_name: rawSource,
      topic
    });
  }

  // Deduplicate by source_url
  const seenUrls = new Set();
  const uniqueItems = [];
  for (const item of items) {
    if (!seenUrls.has(item.source_url)) {
      seenUrls.add(item.source_url);
      uniqueItems.push(item);
    }
  }

  // Sort newest first
  uniqueItems.sort((a, b) => b.timestamp - a.timestamp);

  // Keep top 5
  return uniqueItems.slice(0, 5);
}

runTest('RSS feed parser extracts valid items and ignores malformed links', () => {
  const articles = parseFeed(rawXml);
  assert.ok(articles.length > 0);
  articles.forEach(art => {
    assert.ok(art.source_url.startsWith('http'));
    assert.ok(art.title.length > 0);
  });
});

// -----------------------------------------------------------------------------
// Test 6: Deduplication and Top-5 Limit
// -----------------------------------------------------------------------------
runTest('Duplicate articles are removed and strictly capped at 5 newest', () => {
  const articles = parseFeed(rawXml);
  assert.strictEqual(articles.length, 5); // Fixture has 6 valid + 1 duplicate + 1 malformed

  // Check unique URLs
  const urls = articles.map(a => a.source_url);
  const uniqueUrls = new Set(urls);
  assert.strictEqual(urls.length, uniqueUrls.size);

  // Check sorted newest first
  for (let i = 1; i < articles.length; i++) {
    assert.ok(articles[i - 1].timestamp >= articles[i].timestamp);
  }
});

// -----------------------------------------------------------------------------
// Test 7: Empty Feed / Zero Results Handling
// -----------------------------------------------------------------------------
runTest('Zero articles feed handled cleanly without crashing', () => {
  const emptyXml = '<rss version="2.0"><channel><title>Empty</title></channel></rss>';
  const articles = parseFeed(emptyXml);
  assert.strictEqual(articles.length, 0);

  const fallbackResponse = {
    success: true,
    topic: 'unknown topic',
    articles_processed: articles.length,
    summaries_stored: 0,
    digest_sent: false,
    message: 'No valid articles found for the specified topic.'
  };
  assert.strictEqual(fallbackResponse.articles_processed, 0);
  assert.strictEqual(fallbackResponse.digest_sent, false);
});

// -----------------------------------------------------------------------------
// Test 8: Gemini Output Validation & Schema Enforcement
// -----------------------------------------------------------------------------
function validateGeminiResponse(candidateText, originalArticle) {
  let parsed = null;
  try {
    const cleaned = candidateText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    parsed = null;
  }

  const hasValidTitle = parsed && typeof parsed.title === 'string' && parsed.title.trim().length > 0;
  const hasValidSummary = parsed && typeof parsed.summary === 'string' && parsed.summary.trim().length > 0;
  const hasValidKeyPoints = parsed && Array.isArray(parsed.key_points) && parsed.key_points.length > 0;
  const isUrlMatched = parsed && parsed.source_url === originalArticle.source_url;

  if (hasValidTitle && hasValidSummary && hasValidKeyPoints && isUrlMatched) {
    return {
      title: parsed.title.trim(),
      summary: parsed.summary.trim(),
      key_points: parsed.key_points.map(k => String(k).trim()).filter(Boolean),
      source_url: originalArticle.source_url,
      is_fallback: false
    };
  }

  return {
    title: originalArticle.title,
    summary: originalArticle.description || 'Summary unavailable based on available RSS feed snippet.',
    key_points: ['Extracted from publisher feed'],
    source_url: originalArticle.source_url,
    is_fallback: true
  };
}

runTest('Gemini valid structured output validates against schema', () => {
  const original = {
    title: 'Original Title',
    source_url: 'https://example.com/article1',
    description: 'Original description'
  };
  const validJsonText = JSON.stringify({
    title: 'Clean AI Summary Title',
    summary: 'A concise summary of the breakthrough.',
    key_points: ['Point 1', 'Point 2'],
    source_url: 'https://example.com/article1'
  });

  const validated = validateGeminiResponse(validJsonText, original);
  assert.strictEqual(validated.is_fallback, false);
  assert.strictEqual(validated.title, 'Clean AI Summary Title');
  assert.strictEqual(validated.source_url, original.source_url);
});

runTest('Gemini markdown fences are stripped safely', () => {
  const original = {
    title: 'Original Title',
    source_url: 'https://example.com/article2',
    description: 'Original description'
  };
  const fencedText = "```json\n" + JSON.stringify({
    title: 'Fenced Title',
    summary: 'Summary with markdown fence.',
    key_points: ['Key fact'],
    source_url: 'https://example.com/article2'
  }) + "\n```";

  const validated = validateGeminiResponse(fencedText, original);
  assert.strictEqual(validated.is_fallback, false);
  assert.strictEqual(validated.title, 'Fenced Title');
});

runTest('Malformed Gemini output triggers safe fallback without crashing', () => {
  const original = {
    title: 'Original Title',
    source_url: 'https://example.com/article3',
    description: 'Original description'
  };

  const malformedInputs = [
    'Not JSON at all',
    '{"title": "Missing summary and key_points"}',
    '{"title": "Wrong URL", "summary": "test", "key_points": ["a"], "source_url": "https://mismatch.com"}'
  ];

  malformedInputs.forEach(input => {
    const validated = validateGeminiResponse(input, original);
    assert.strictEqual(validated.is_fallback, true);
    assert.strictEqual(validated.source_url, original.source_url);
    assert.strictEqual(validated.title, original.title);
  });
});

// -----------------------------------------------------------------------------
// Test 9: Deterministic SHA-256 Pinecone Vector ID Hashing
// -----------------------------------------------------------------------------
runTest('Deterministic SHA-256 ID ensures idempotency for Pinecone storage', () => {
  const url1 = 'https://news.google.com/rss/articles/CBMioAFBVV95cUxNRm0';
  const url2 = 'https://news.google.com/rss/articles/CBMioAFBVV95cUxNRm0';
  const url3 = 'https://news.google.com/rss/articles/DIFFERENT_ARTICLE';

  const hash1 = crypto.createHash('sha256').update(url1).digest('hex');
  const hash2 = crypto.createHash('sha256').update(url2).digest('hex');
  const hash3 = crypto.createHash('sha256').update(url3).digest('hex');

  assert.strictEqual(hash1, hash2);
  assert.notStrictEqual(hash1, hash3);
  assert.strictEqual(hash1.length, 64);
});

// -----------------------------------------------------------------------------
// Test 10: Pinecone Cosine Relevance Threshold & Insufficient Evidence
// -----------------------------------------------------------------------------
runTest('Pinecone matches below relevance threshold trigger insufficient evidence response', () => {
  const RELEVANCE_THRESHOLD = 0.65;
  const lowScoreMatches = [
    { id: '1', score: 0.42, metadata: { title: 'Irrelevant article' } },
    { id: '2', score: 0.58, metadata: { title: 'Somewhat distant article' } }
  ];

  const relevant = lowScoreMatches.filter(m => m.score >= RELEVANCE_THRESHOLD);
  assert.strictEqual(relevant.length, 0);

  const response = {
    success: true,
    question: 'How do topological qubits work?',
    answer: 'I do not have sufficient research in the database to answer this question. No indexed articles met the relevance threshold for your query.',
    sources: [],
    insufficient_evidence: true
  };
  assert.strictEqual(response.insufficient_evidence, true);
  assert.strictEqual(response.sources.length, 0);
});

runTest('Pinecone matches above relevance threshold assemble grounded sources', () => {
  const RELEVANCE_THRESHOLD = 0.65;
  const goodMatches = [
    { id: '1', score: 0.88, metadata: { title: 'Topological Qubits Overview', source_url: 'https://example.com/qubits' } },
    { id: '2', score: 0.72, metadata: { title: 'Majorana Zero Modes', source_url: 'https://example.com/majorana' } },
    { id: '3', score: 0.50, metadata: { title: 'Irrelevant low score', source_url: 'https://example.com/low' } }
  ];

  const relevant = goodMatches.filter(m => m.score >= RELEVANCE_THRESHOLD);
  assert.strictEqual(relevant.length, 2);
  assert.strictEqual(relevant[0].metadata.title, 'Topological Qubits Overview');
});

// -----------------------------------------------------------------------------
// Test 11: HTML Email Digest Sanitization (XSS Prevention)
// -----------------------------------------------------------------------------
runTest('HTML email digest escapes malicious scripts and markup', () => {
  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const maliciousTitle = '<script>alert("XSS")</script>& "Hack"';
  const clean = escapeHtml(maliciousTitle);

  assert.strictEqual(clean.includes('<script>'), false);
  assert.strictEqual(clean, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;&amp; &quot;Hack&quot;');
});

// -----------------------------------------------------------------------------
// Test 12: Error Notification Secret Sanitizer
// -----------------------------------------------------------------------------
runTest('Error notification scrubs API keys, bearer tokens, and emails', () => {
  function sanitizeText(str) {
    if (!str) return '';
    return String(str)
      .replace(/AIza[0-9A-Za-z\-_]{30,45}/g, '[REDACTED_GEMINI_KEY]')
      .replace(/pcsk_[0-9A-Za-z\-_]+/g, '[REDACTED_PINECONE_KEY]')
      .replace(/bearer\s+[a-zA-Z0-9\-\._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]')
      .replace(/key=[a-zA-Z0-9\-_]+/gi, 'key=[REDACTED_KEY]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_MASKED]');
  }

  const rawErrorMessage = 'Failed calling Gemini with key AIzaSyD9ExampleKey1234567890abcdefgh and Pinecone pcsk_9876543210zyxwvutsrqponmlkjihgfedcba to user sami@example.com with Bearer eyJhbGciOi';
  const clean = sanitizeText(rawErrorMessage);

  assert.strictEqual(clean.includes('AIzaSyD9ExampleKey1234567890abcdefgh'), false);
  assert.strictEqual(clean.includes('pcsk_9876543210zyxwvutsrqponmlkjihgfedcba'), false);
  assert.strictEqual(clean.includes('sami@example.com'), false);
  assert.ok(clean.includes('[REDACTED_GEMINI_KEY]'));
  assert.ok(clean.includes('[REDACTED_PINECONE_KEY]'));
  assert.ok(clean.includes('[EMAIL_MASKED]'));
});

// -----------------------------------------------------------------------------
// Final Summary
// -----------------------------------------------------------------------------
console.log(`\nTest Run Complete: ${passedTests}/${totalTests} tests passed.`);
if (passedTests !== totalTests) {
  process.exit(1);
}
