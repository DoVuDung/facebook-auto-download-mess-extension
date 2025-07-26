(async () => {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const scrollContainer = document.querySelector('[role="main"]');

  if (!scrollContainer) {
    alert("❌ Không tìm thấy vùng tin nhắn để cuộn.");
    return;
  }

  // --- 1. Tự động cuộn lên top ---
  let lastScrollTop = -1;
  let sameCount = 0;
  const maxTries = 20;

  console.log("🔃 Đang cuộn lên để tải toàn bộ tin nhắn...");

  while (sameCount < 10 && sameCount < maxTries) {
    scrollContainer.scrollTop = 0;
    await sleep(1000);

    const currentScrollTop = scrollContainer.scrollTop;
    if (currentScrollTop === lastScrollTop) {
      sameCount++;
    } else {
      sameCount = 0;
      lastScrollTop = currentScrollTop;
    }
  }

  console.log("✅ Đã cuộn xong. Bắt đầu trích xuất...");

  // --- 2. Trích xuất tin nhắn ---
  const rows = document.querySelectorAll('[role="row"]');
  const output = [];
  let currentDate = "";

  const getSenderName = (row) => {
    const isOutgoing = row.getAttribute("data-testid")?.includes("outgoing");
    return isOutgoing ? "YOU" : "OTHER";
  };

  rows.forEach((row) => {
    const dateLabel = row.querySelector("h4, h5");
    const messageNode = row.querySelector("div[dir='auto']");

    // Dòng ngày
    if (dateLabel && !messageNode) {
      const dateText = dateLabel.textContent.trim();
      if (dateText && dateText !== currentDate) {
        currentDate = dateText;
        output.push(`\n${dateText}\n`);
      }
      return;
    }

    // Dòng tin nhắn
    if (messageNode) {
      const message = messageNode.textContent.trim();
      const sender = getSenderName(row);
      if (message) {
        output.push(`${sender}: ${message}`);
      }
    }
  });

  // --- 3. Xuất file .txt ---
  const result = output.join("\n");
  const blob = new Blob([result], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Messenger_Export.txt";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  console.log("✅ File đã tải xong.");
})();
