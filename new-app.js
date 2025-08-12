// Create or open the ReviewDB
let reviewDb;
const request = indexedDB.open("ReviewDB", 1);

request.onupgradeneeded = function (e) {
  reviewDb = e.target.result;
  if (!reviewDb.objectStoreNames.contains("reviews")) {
    reviewDb.createObjectStore("reviews", { keyPath: "id", autoIncrement: true });
  }
};

request.onsuccess = function (e) {
  reviewDb = e.target.result;
  renderReviews(); // Load existing reviews on page load
  populateServiceFilterDropdown();
};

request.onerror = function (e) {
  console.error("Error opening ReviewDB", e);
};

// Submit review
document.getElementById("reviewForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const name = document.getElementById("name").value;
  const service = document.getElementById("service").value;
  const rating = parseInt(document.getElementById("rating").value);
  const message = document.getElementById("message").value;
  const date = new Date().toLocaleDateString();

  const review = { name, service, rating, message, date };

  const tx = reviewDb.transaction("reviews", "readwrite");
  const store = tx.objectStore("reviews");
  store.add(review);
  showToast("Review submitted successfully!");


  tx.oncomplete = () => {
    document.getElementById("reviewForm").reset();
    renderReviews();
  };
});

function populateServiceFilterDropdown() {
  const serviceFilter = document.getElementById("serviceFilter");
  serviceFilter.innerHTML = `<option value="All">All Services</option>`; // reset

  const salonDbRequest = indexedDB.open("SalonDB", 1);
  salonDbRequest.onsuccess = function (e) {
    const salonDb = e.target.result;
    const tx = salonDb.transaction("services", "readonly");
    const store = tx.objectStore("services");
    const request = store.openCursor();
    const uniqueServices = new Set();

    request.onsuccess = function (e) {
      const cursor = e.target.result;
      if (cursor) {
        const { name } = cursor.value;
        if (!uniqueServices.has(name)) {
          uniqueServices.add(name);
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          serviceFilter.appendChild(option);
        }
        cursor.continue();
      }
    };
  };
}


// Load and display reviews
function renderReviews() {
  const tbody = document.querySelector("#reviewTable tbody");
  tbody.innerHTML = "";

  const tx = reviewDb.transaction("reviews", "readonly");
  const store = tx.objectStore("reviews");
  const request = store.openCursor();

  request.onsuccess = function (e) {
    const cursor = e.target.result;
    if (cursor) {
      const { name, service, rating, message, date } = cursor.value;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${name}</td>
        <td>${service}</td>
        <td>${"⭐".repeat(rating)}</td>
        <td>${message}</td>
        <td>${date}</td>
      `;
      tbody.appendChild(tr);
      cursor.continue();
    }
  };
}

function showToast(message = "Review submitted successfully!") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.style.opacity = 1;
  toast.style.transform = "translateY(0)";
  
  setTimeout(() => {
    toast.style.opacity = 0;
    toast.style.transform = "translateY(20px)";
  }, 3000);
}

function printReviews() {
  const printContents = document.getElementById("reviewTable").outerHTML;
  const originalContents = document.body.innerHTML;

  document.body.innerHTML = `
    <html>
      <head><title>Print Reviews</title></head>
      <body>
        <h2>Customer Reviews - Sista Sista Salon & Spa</h2>
        ${printContents}
      </body>
    </html>`;
  window.print();
  document.body.innerHTML = originalContents;
  window.location.reload(); // reload page after print
}

function exportReviewsCSV() {
  const table = document.getElementById("reviewTable");
  let csv = [];
  for (let row of table.rows) {
    let rowData = [];
    for (let cell of row.cells) {
      rowData.push('"' + cell.innerText + '"');
    }
    csv.push(rowData.join(","));
  }

  const blob = new Blob([csv.join("\n")], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "reviews.csv";
  a.click();
  window.URL.revokeObjectURL(url);
}

document.getElementById('serviceFilter').addEventListener('change', function () {
  const selected = this.value;
  const table = document.querySelector('#reviewTable tbody');
  const rows = table.querySelectorAll('tr');

  rows.forEach(row => {
    const service = row.children[1].textContent;
    if (selected === 'All' || service === selected) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
});
