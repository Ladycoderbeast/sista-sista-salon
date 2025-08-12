document.addEventListener('DOMContentLoaded', () => {
  const userIcon = document.getElementById('userIcon');
  const userDropdown = document.getElementById('userDropdown');
  const usernameDisplay = document.getElementById('loggedInUser');

  const user = JSON.parse(localStorage.getItem("loggedUser"));

  if (user && usernameDisplay) {
    usernameDisplay.textContent = user.username;
  }

  if (userIcon && userDropdown) {
    userIcon.addEventListener('click', () => {
      const isVisible = userDropdown.style.display === 'block';
      userDropdown.style.display = isVisible ? 'none' : 'block';
    });

    document.addEventListener('click', (e) => {
      if (!userIcon.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.style.display = 'none';
      }
    });
  }
});