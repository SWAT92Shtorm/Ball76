from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support import expected_conditions as EC
import time
import csv
from datetime import datetime

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))

# Открываем уже готовую страницу
driver.get("http://qlapinui.dqsmd.qrundigital.diasoft.ru/interface/qlapinui/qlapin-45/processes/product-info?process=input-app&appId=66993737-4e12-3394-75f7-69a1aae4b062")
time.sleep(5)  # Ждём загрузки динамических элементов

    
login_field = driver.find_element(By.CSS_SELECTOR, "app-username-type input")
login_field.send_keys("msa") 

login_field = driver.find_element(By.CSS_SELECTOR, "#password input")
login_field.send_keys("1234567890") 

time.sleep(1)  # Ждём загрузки динамических элементов 

submit_button = driver.find_element(By.CSS_SELECTOR, ".p-d-flex.p-flex-column.w-full.p-gap-2 button")
submit_button.click()

time.sleep(10)  # Ждём загрузки динамических элементов 

print("\n🔍 Шаг 3: Извлекаем все поля через JavaScript...")
    
fields = driver.execute_script("""
                    var value = el.value || '';
            if (value && value.trim()) {
                // Ищем label для этого элемента
                var label = '';
                
                // Если есть ID - ищем label[for="id"]
                if (el.id && el.id.length > 0) {
                    var labelEl = document.querySelector('label[for="' + el.id + '"]');
                    if (labelEl) {
                        label = labelEl.textContent;
                    }
                }
                
                // Если label не нашли - пробуем имя, заглушку или ID
                if (!label || label.length === 0) {
                    label = el.placeholder || el.name || el.id || 'Без названия';
                }
                
                result.push({
                    name: label.trim(),
                    value: value.trim()
                });
            }
        });
        
        return result;
    """)
    
print("\n=== ДАННЫЕ ФОРМЫ ===")
for i, f in enumerate(fields):
        print(f"{i+1}. {f['name']}: {f['value']}")
    
    # 5. СОХРАНЕНИЕ
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
csv_file = f"form_data_{timestamp}.csv"
with open(csv_file, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Название", "Значение"])
        writer.writeheader()
        writer.writerows([{"Название": f["name"], "Значение": f["value"]} for f in fields])
    
print(f"\n✅ Сохранено: {csv_file}")
    

driver.quit()