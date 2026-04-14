/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const clearSelectedProductsButton = document.getElementById("clearSelectedProducts");
const generateRoutineButton = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");

let allProductsCache = [];
const selectedProductIds = new Set();
const expandedDescriptionIds = new Set();
let conversationMessages = [];
let routineIsGenerated = false;
const selectedProductsStorageKey = "lorealRoutineBuilderSelectedProducts";

let currentCategory = "";
let currentSearchQuery = "";

function saveSelectedProductsToStorage() {
  try {
    localStorage.setItem(
      selectedProductsStorageKey,
      JSON.stringify(Array.from(selectedProductIds))
    );
  } catch (error) {
    /* Ignore storage failures and keep the in-memory selection working. */
  }
}

function loadSelectedProductsFromStorage() {
  try {
    const storedValue = localStorage.getItem(selectedProductsStorageKey);
    const storedIds = storedValue ? JSON.parse(storedValue) : [];

    storedIds
      .map((productId) => Number(productId))
      .filter((productId) => !Number.isNaN(productId))
      .forEach((productId) => selectedProductIds.add(productId));
  } catch (error) {
    selectedProductIds.clear();
  }
}

function clearSelectedProducts() {
  selectedProductIds.clear();
  expandedDescriptionIds.clear();
  saveSelectedProductsToStorage();
  updateSelectedProductsList();
  updateProductCardStates();
}

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

selectedProductsList.innerHTML = `
  <div class="placeholder-message selected-placeholder">
    Selected products will appear here.
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  if (allProductsCache.length > 0) {
    return allProductsCache;
  }

  const response = await fetch("products.json");
  const data = await response.json();
  allProductsCache = data.products;
  return allProductsCache;
}

function getProductById(productId) {
  return allProductsCache.find((product) => product.id === productId);
}

function isProductSelected(productId) {
  return selectedProductIds.has(productId);
}

function isDescriptionExpanded(productId) {
  return expandedDescriptionIds.has(productId);
}

function productMatchesSearch(product, searchQuery) {
  if (!searchQuery) {
    return true;
  }

  const searchableText = [
    product.name,
    product.brand,
    product.category,
    product.description,
  ]
    .join(" ")
    .toLowerCase();

  return searchableText.includes(searchQuery);
}

function getFilteredProducts() {
  const normalizedSearchQuery = currentSearchQuery.trim().toLowerCase();

  return allProductsCache.filter((product) => {
    const categoryMatches = !currentCategory || product.category === currentCategory;
    const searchMatches = productMatchesSearch(product, normalizedSearchQuery);

    return categoryMatches && searchMatches;
  });
}

function appendChatMessage(message, role) {
  const messageElement = document.createElement("div");
  messageElement.className = `chat-message chat-message-${role}`;
  messageElement.textContent = message;
  chatWindow.appendChild(messageElement);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function clearChatWindow() {
  chatWindow.innerHTML = "";
}

function addChatTurn(role, content) {
  conversationMessages.push({ role, content });
  appendChatMessage(content, role);
}

async function getSelectedProductsData() {
  await loadProducts();

  return Array.from(selectedProductIds)
    .map((productId) => getProductById(productId))
    .filter(Boolean)
    .map((product) => ({
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
    }));
}

function setRoutineButtonLoading(isLoading) {
  generateRoutineButton.disabled = isLoading || selectedProductIds.size === 0;
  generateRoutineButton.innerHTML = isLoading
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Generating...'
    : '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Routine';
}

function buildConversationContext(selectedProducts) {
  return [
    "You are a helpful beauty advisor.",
    "Use the selected routine and the full conversation history to answer follow-up questions.",
    "Only answer questions related to the generated routine or related topics like skincare, haircare, makeup, fragrance, and similar beauty areas.",
    "If the user asks about something unrelated, politely redirect them back to the routine or a relevant beauty topic.",
    `Current selected products:\n${JSON.stringify(selectedProducts, null, 2)}`,
  ].join("\n\n");
}

async function requestChatCompletion(messages) {
  const response = await fetch(workerURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Worker request failed with status ${response.status}.`);
  }

  const responseText = await response.text();

  try {
    return JSON.parse(responseText);
  } catch (error) {
    return {
      reply: responseText,
    };
  }
}

async function renderFilteredProducts() {
  await loadProducts();

  if (!currentCategory && !currentSearchQuery.trim()) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        Select a category or search for a product.
      </div>
    `;
    return;
  }

  const emptyMessage = currentSearchQuery.trim()
    ? "No products match your search."
    : "No products found for this category.";

  displayProducts(getFilteredProducts(), emptyMessage);
}

async function generateRoutine() {
  if (typeof workerURL === "undefined" || !workerURL) {
    addChatTurn(
      "assistant",
      "Add your Cloudflare Worker URL to secrets.js before generating a routine."
    );
    return;
  }

  const selectedProducts = await getSelectedProductsData();

  if (selectedProducts.length === 0) {
    addChatTurn(
      "assistant",
      "Select at least one product before generating a routine."
    );
    return;
  }

  setRoutineButtonLoading(true);
  clearChatWindow();
  conversationMessages = [];
  routineIsGenerated = false;
  addChatTurn("assistant", "Generating your personalized routine...");

  const systemPrompt = buildConversationContext(selectedProducts);

  const userPrompt = `Selected products data:\n${JSON.stringify(
    selectedProducts,
    null,
    2
  )}\n\nWrite a personalized routine that explains how to use these products.`;

  try {
    const data = await requestChatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const routine = (data.reply || data.choices?.[0]?.message?.content || "").trim();

    if (!routine) {
      throw new Error("No routine was returned.");
    }

    chatWindow.innerHTML = "";
    conversationMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      { role: "assistant", content: routine },
    ];
    appendChatMessage(routine, "assistant");
    routineIsGenerated = true;
  } catch (error) {
    addChatTurn(
      "assistant",
      "Something went wrong while generating the routine. Check your Worker URL and try again."
    );
  } finally {
    setRoutineButtonLoading(false);
  }
}

function updateSelectedProductsList() {
  const selectedProducts = Array.from(selectedProductIds)
    .map((productId) => getProductById(productId))
    .filter(Boolean);

  const validSelectedIds = selectedProducts.map((product) => product.id);

  if (validSelectedIds.length !== selectedProductIds.size) {
    selectedProductIds.clear();
    validSelectedIds.forEach((productId) => selectedProductIds.add(productId));
  }

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <div class="placeholder-message selected-placeholder">
        Selected products will appear here.
      </div>
    `;
    generateRoutineButton.disabled = true;
    clearSelectedProductsButton.disabled = true;
    saveSelectedProductsToStorage();
    return;
  }

  generateRoutineButton.disabled = false;
  clearSelectedProductsButton.disabled = false;

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
        <div class="selected-item" data-product-id="${product.id}">
          <div class="selected-item-copy">
            <span class="selected-item-brand">${product.brand}</span>
            <strong>${product.name}</strong>
          </div>
          <button type="button" class="remove-selected-btn" aria-label="Remove ${product.name}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `
    )
    .join("");

  saveSelectedProductsToStorage();
}

function updateProductCardStates() {
  const cards = productsContainer.querySelectorAll(".product-card");

  cards.forEach((card) => {
    const productId = Number(card.dataset.productId);
    const selected = isProductSelected(productId);
    const descriptionExpanded = isDescriptionExpanded(productId);
    const descriptionButton = card.querySelector(".toggle-description-btn");
    const descriptionPanel = card.querySelector(".product-description");

    card.classList.toggle("is-selected", selected);
    card.classList.toggle("is-description-open", descriptionExpanded);
    card.setAttribute("aria-pressed", String(selected));

    if (descriptionButton) {
      descriptionButton.setAttribute("aria-expanded", String(descriptionExpanded));
      descriptionButton.innerHTML = descriptionExpanded
        ? '<i class="fa-solid fa-angle-up"></i> Hide description'
        : '<i class="fa-solid fa-angle-down"></i> View description';
    }

    if (descriptionPanel) {
      descriptionPanel.hidden = !descriptionExpanded;
    }
  });
}

function toggleProductDescription(productId) {
  if (expandedDescriptionIds.has(productId)) {
    expandedDescriptionIds.delete(productId);
  } else {
    expandedDescriptionIds.add(productId);
  }

  updateProductCardStates();
}

function toggleProductSelection(productId) {
  if (selectedProductIds.has(productId)) {
    selectedProductIds.delete(productId);
  } else {
    selectedProductIds.add(productId);
  }

  updateSelectedProductsList();
  updateProductCardStates();
}

/* Create HTML for displaying product cards */
function displayProducts(products, emptyMessage = "No products found for this category.") {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        ${emptyMessage}
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div class="product-card${isProductSelected(product.id) ? " is-selected" : ""}" data-product-id="${product.id}" role="button" tabindex="0" aria-pressed="${isProductSelected(product.id)}">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <div class="brand-name">${product.brand}</div>
        <h3>${product.name}</h3>
        <div class="product-category">${product.category}</div>
        <button
          type="button"
          class="toggle-description-btn"
          aria-expanded="${isDescriptionExpanded(product.id)}"
          aria-controls="product-description-${product.id}"
        >
          <i class="fa-solid fa-angle-${isDescriptionExpanded(product.id) ? "up" : "down"}"></i>
          ${isDescriptionExpanded(product.id) ? "Hide description" : "View description"}
        </button>
        <div class="product-description" id="product-description-${product.id}" hidden>
          <p>${product.description}</p>
        </div>
      </div>
    </div>
  `
    )
    .join("");

  updateProductCardStates();
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  currentCategory = e.target.value;
  await renderFilteredProducts();
});

productSearch.addEventListener("input", async (e) => {
  currentSearchQuery = e.target.value;
  await renderFilteredProducts();
});

productsContainer.addEventListener("click", (e) => {
  const descriptionButton = e.target.closest(".toggle-description-btn");

  if (descriptionButton) {
    e.preventDefault();
    e.stopPropagation();

    const productCard = descriptionButton.closest(".product-card");
    const productId = Number(productCard.dataset.productId);
    toggleProductDescription(productId);
    return;
  }

  const productCard = e.target.closest(".product-card");

  if (!productCard) {
    return;
  }

  const productId = Number(productCard.dataset.productId);
  toggleProductSelection(productId);
});

productsContainer.addEventListener("keydown", (e) => {
  if (e.target.closest(".toggle-description-btn")) {
    return;
  }

  if (e.key !== "Enter" && e.key !== " ") {
    return;
  }

  const productCard = e.target.closest(".product-card");

  if (!productCard) {
    return;
  }

  e.preventDefault();
  const productId = Number(productCard.dataset.productId);
  toggleProductSelection(productId);
});

selectedProductsList.addEventListener("click", (e) => {
  const removeButton = e.target.closest(".remove-selected-btn");

  if (!removeButton) {
    return;
  }

  const selectedItem = removeButton.closest(".selected-item");
  const productId = Number(selectedItem.dataset.productId);
  toggleProductSelection(productId);
});

clearSelectedProductsButton.addEventListener("click", () => {
  clearSelectedProducts();
});

generateRoutineButton.addEventListener("click", generateRoutine);

async function askFollowUpQuestion(question) {
  if (typeof workerURL === "undefined" || !workerURL) {
    addChatTurn(
      "assistant",
      "Add your Cloudflare Worker URL to secrets.js before asking follow-up questions."
    );
    return;
  }

  if (!routineIsGenerated) {
    addChatTurn(
      "assistant",
      "Generate a routine first, then ask a follow-up question."
    );
    return;
  }

  const selectedProducts = await getSelectedProductsData();
  const systemPrompt = buildConversationContext(selectedProducts);

  addChatTurn("user", question);

  try {
    const data = await requestChatCompletion([
      { role: "system", content: systemPrompt },
      ...conversationMessages.filter((message) => message.role !== "system"),
    ]);
    const answer = (data.reply || data.choices?.[0]?.message?.content || "").trim();

    if (!answer) {
      throw new Error("No follow-up answer was returned.");
    }

    conversationMessages.push({ role: "assistant", content: answer });
    appendChatMessage(answer, "assistant");
  } catch (error) {
    addChatTurn(
      "assistant",
      "Something went wrong while answering that question. Please try again."
    );
  }
}

setRoutineButtonLoading(false);

async function initializeApp() {
  loadSelectedProductsFromStorage();
  await loadProducts();
  updateSelectedProductsList();
  updateProductCardStates();
}

initializeApp();

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const userInput = document.getElementById("userInput");
  const question = userInput.value.trim();

  if (!question) {
    return;
  }

  userInput.value = "";
  askFollowUpQuestion(question);
});
