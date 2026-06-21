const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";

// declared here so every function below can reference them

let form, input, formMessage, resultsSection, audioPlayer;


function initializeApp() {
  form = document.getElementById("search-form");
  input = document.getElementById("word-input");
  formMessage = document.getElementById("form-message");
  resultsSection = document.getElementById("results");

  // single shared Audio object reused for every pronunciation playback,
  // so a second click interrupts/restarts rather than stacking sounds.
  audioPlayer = new Audio();

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const word = input.value.trim();

    // handle empty / invalid input before ever touching the network
    if (!word) {
      showFormMessage("Type a word before searching.");
      return;
    }

    clearFormMessage();
    lookupWord(word);
  });
}


// Core async flow: fetch -> parse -> render
async function lookupWord(word) {
  showLoadingState();

  try {
    const response = await fetch(`${API_BASE}${encodeURIComponent(word)}`);

    // the API returns a 404 with a JSON error body when a word isn't found
    if (!response.ok) {
      if (response.status === 404) {
        showErrorState(
          "No definitions found",
          `We couldn't find an entry for "${word}". Check the spelling and try again.`
        );
      } else {
        showErrorState(
          "Something went wrong",
          `The dictionary service returned an unexpected error (status ${response.status}).`
        );
      }
      return;
    }

    const data = await response.json();
    renderEntries(data);

  } catch (error) {
    // catches network failures
    showErrorState(
      "Connection problem",
      "We couldn't reach the dictionary service. Check your connection and try again."
    );
  }
}


// Rendering: builds DOM elements from the parsed API data
function renderEntries(entries) {
  clearResults();

  const audioUrl = findFirstAudioUrl(entries);
  const hasMultipleEntries = entries.length > 1;

  entries.forEach((entry, index) => {
    resultsSection.appendChild(
      buildEntryElement(entry, index, hasMultipleEntries, audioUrl)
    );
  });
}

function buildEntryElement(entry, index, hasMultipleEntries, sharedAudioUrl) {
  const article = document.createElement("article");
  article.className = "entry";

  // Headword + underline + audio button 
  const head = document.createElement("div");
  head.className = "entry-head";

  const wordWrap = document.createElement("div");
  wordWrap.className = "entry-word-wrap";

  const heading = document.createElement("h2");
  heading.className = "entry-word";
  heading.textContent = entry.word;

  // dictionary-style superscript numbering only when a word has multiple distinct entries

  if (hasMultipleEntries) {
    const sup = document.createElement("sup");
    sup.textContent = index + 1;
    heading.appendChild(sup);
  }

  wordWrap.appendChild(heading);


  // only render the audio button once, on the first entry, since pronunciation audio applies to the word as a whole
  let audioButton = null;
  if (index === 0) {
    audioButton = buildAudioButton(sharedAudioUrl);
  }

  head.appendChild(wordWrap);
  if (audioButton) head.appendChild(audioButton);

  // phonetic transcription 
  const phoneticText = entry.phonetic || findFirstPhoneticText(entry.phonetics);
  const phonetic = document.createElement("p");
  phonetic.className = "entry-phonetic";
  phonetic.textContent = phoneticText || "Pronunciation unavailable";

  article.appendChild(head);
  article.appendChild(phonetic);

  // meanings
  entry.meanings.forEach((meaning) => {
    article.appendChild(buildMeaningElement(meaning));
  });

  return article;
}

function buildMeaningElement(meaning) {
  const wrapper = document.createElement("div");
  wrapper.className = "meaning";

  const pos = document.createElement("span");
  pos.className = "part-of-speech";
  pos.textContent = meaning.partOfSpeech;
  wrapper.appendChild(pos);

  // definitions list
  const list = document.createElement("ol");
  list.className = "definitions-list";

  meaning.definitions.forEach((def) => {
    const li = document.createElement("li");
    li.textContent = def.definition;

    // example sentences are optional in the API response
    if (def.example) {
      const example = document.createElement("span");
      example.className = "definition-example";
      example.textContent = def.example;
      li.appendChild(document.createElement("br"));
      li.appendChild(example);
    }

    list.appendChild(li);
  });

  wrapper.appendChild(list);

  // Synonyms (with graceful fallback)
  const synonyms = collectSynonyms(meaning);

  if (synonyms.length > 0) {
    const row = document.createElement("div");
    row.className = "synonyms-row";

    const label = document.createElement("span");
    label.className = "synonyms-label";
    label.textContent = "Synonyms";
    row.appendChild(label);

    synonyms.forEach((word) => {
      const tag = document.createElement("span");
      tag.className = "synonym-tag";
      tag.textContent = word;
      row.appendChild(tag);
    });

    wrapper.appendChild(row);
  } else {
    const fallback = document.createElement("p");
    fallback.className = "no-synonyms";
    fallback.textContent = "No synonyms available for this meaning.";
    wrapper.appendChild(fallback);
  }

  return wrapper;
}


// audio playback
function buildAudioButton(audioUrl) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "play-audio-button";
  button.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 5v4h2.5L8 12V2L4.5 5H2z" fill="currentColor"/>
      <path d="M10 4.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
  `;

  if (!audioUrl) {
    // gracefully disable the button when no audio clip exists
    button.disabled = true;
    button.setAttribute("aria-label", "Pronunciation audio unavailable");
  } else {
    button.setAttribute("aria-label", "Play pronunciation");
    button.addEventListener("click", () => {
      audioPlayer.src = audioUrl;
      audioPlayer.play();
    });
  }

  return button;
}

function findFirstAudioUrl(entries) {
  for (const entry of entries) {
    if (!entry.phonetics) continue;
    const withAudio = entry.phonetics.find((p) => p.audio && p.audio.length > 0);
    if (withAudio) return withAudio.audio;
  }
  return null;
}

function findFirstPhoneticText(phonetics) {
  if (!phonetics) return null;
  const withText = phonetics.find((p) => p.text && p.text.length > 0);
  return withText ? withText.text : null;
}


// data helpers
function collectSynonyms(meaning) {
  // synonyms can live at the meaning level AND inside each definition.
  const fromMeaning = meaning.synonyms || [];
  const fromDefinitions = meaning.definitions.flatMap((def) => def.synonyms || []);

  const unique = new Set([...fromMeaning, ...fromDefinitions]);

  // cap the display list so a word with 40 synonyms doesn't overwhelm the UI
  return Array.from(unique).slice(0, 8);
}


// UI state helpers
function showLoadingState() {
  resultsSection.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "loading-state";
  loading.textContent = "Searching...";
  resultsSection.appendChild(loading);
}

function showErrorState(title, message) {
  resultsSection.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "error-state";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const text = document.createElement("p");
  text.textContent = message;

  wrapper.appendChild(heading);
  wrapper.appendChild(text);
  resultsSection.appendChild(wrapper);
}

function clearResults() {
  resultsSection.innerHTML = "";
}

function showFormMessage(message) {
  formMessage.textContent = message;
  formMessage.classList.remove("hidden");
}

function clearFormMessage() {
  formMessage.textContent = "";
  formMessage.classList.add("hidden");
}


if (typeof document !== "undefined" && document.getElementById("search-form")) {
  initializeApp();
}


if (typeof module !== "undefined") {
  module.exports = {
    initializeApp,
    lookupWord,
    renderEntries,
    collectSynonyms,
    findFirstAudioUrl,
    findFirstPhoneticText,
    showFormMessage,
    clearFormMessage,
  };
}