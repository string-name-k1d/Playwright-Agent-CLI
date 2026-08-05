# Prompts: Add Standard Page (MTPC)

Test prompts for the "Add Standard Page" form at `/node/add/custom_page/mtpc`.
Covers page creation, sections, content blocks, and form submission.
For each case, before starting: make sure user is at correct url editing target page; at the end: publish page and screenshot to inspect changes.

---

## 1. Create Basic Page with Title [standalone]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Fill in the Page Title field with "Test Standard Page" and verify the title appears in the field.

---

## 2. Set Template Category [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Select "Content Pages" from the Template Category dropdown and verify the selection is applied.

---

## 3. Add 1-Column Section [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Click "Add 1-Column Section", then verify a new section appears with the label "1-Column Section" and fields for Section Name, Full Width, Hide on Desktop, Hide on Tablet, Hide on Mobile, and Disabled.

---

## 4. Configure 1-Column Section Name [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, type "Hero Section" into the Section Name field, and verify the text appears in the field.

---

## 5. Toggle Section Full Width [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, check the "Full Width" checkbox, and verify it becomes checked. Then uncheck it and verify it becomes unchecked.

---

## 6. Set Section Visibility [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, check the "Hide on Desktop" checkbox, verify it becomes checked. Then check "Hide on Tablet" and "Hide on Mobile", and verify both become checked.

---

## 7. Add Text Area Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Text Area" button in the section, and verify a Text Area block appears with a rich text editor.

---

## 8. Edit Text Area Content [depends: #7]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section with a Text Area block, type "Welcome to our website" into the Text Area field, and verify the text appears.

---

## 9. Add Image Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Image" button in the section, and verify an Image block appears with "Choose Image", "Alt Text", and "Caption" fields.

---

## 10. Add Accordion Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Accordion" button in the section, and verify an Accordion block appears with "Add Accordion Item" button.

---

## 11. Add Accordion Item [depends: #10]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section with an Accordion block, click "Add Accordion Item", and verify an item appears with "Title" and "Content" fields.

---

## 12. Edit Accordion Item [depends: #11]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section with an Accordion block containing an item, type "FAQ Question" into the Title field, type "Answer text here" into the Content field, and verify both texts appear.

---

## 13. Add Image Grid Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Image Grid" button in the section, and verify an Image Grid block appears.

---

## 14. Add Profile Listing Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Profile Listing" button in the section, and verify a Profile Listing block appears with a "Vocabulary" dropdown.

---

## 15. Add Profile Details Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Profile Details" button in the section, and verify a Profile Details block appears.

---

## 16. Add Slideshow Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Slideshow" button in the section, and verify a Slideshow block appears with "Add Slide" button.

---

## 17. Add Slide to Slideshow [depends: #16]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section with a Slideshow block, click "Add Slide", and verify a slide appears with image and caption fields.

---

## 18. Add YouTube/Youku Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "YouTube/Youku" button in the section, and verify a YouTube/Youku block appears with a URL field.

---

## 19. Add Views Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Views" button in the section, and verify a Views block appears with a "View" dropdown.

---

## 20. Add Video Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Video" button in the section, and verify a Video block appears with a "Video" file upload field.

---

## 21. Add Icon & Text Highlight Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Icon & Text Highlight" button in the section, and verify an Icon & Text Highlight block appears with Icon, Title, and Text fields.

---

## 22. Add Events Carousel Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Events Carousel" button in the section, and verify an Events Carousel block appears.

---

## 23. Add 3-Column Carousel Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "3-Column Carousel" button in the section, and verify a 3-Column Carousel block appears with "Add Item" button.

---

## 24. Add Item to 3-Column Carousel [depends: #23]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section with a 3-Column Carousel block, click "Add Item", and verify an item appears with Image, Title, and Text fields.

---

## 25. Add Next & Previous Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Next & Previous" button in the section, and verify a Next & Previous block appears.

---

## 26. Add Navigation Menu Block [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, click the "Navigation Menu" button in the section, and verify a Navigation Menu block appears.

---

## 27. Add 2-Column Section [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Click "Add 2-Column Section", then verify a new section appears with the label "2-Column Section" and a "Reverse Row" checkbox.

---

## 28. Toggle 2-Column Reverse Row [depends: #27]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 2-Column Section, check the "Reverse Row" checkbox, and verify it becomes checked. Then uncheck it and verify it becomes unchecked.

---

## 29. Add Content to 2-Column Section [depends: #27]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 2-Column Section, click "Text Area" in Column 1, click "Image" in Column 2, and verify both blocks appear in their respective columns.

---

## 30. Add 3-Column Section [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Click "Add 3-Column Section", then verify a new section appears with the label "3-Column Section" and fields for Section Name and Disabled.

---

## 31. Add Content to 3-Column Section [depends: #30]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 3-Column Section, click "Text Area" in Column 1, click "Image" in Column 2, click "Views" in Column 3, and verify all three blocks appear.

---

## 32. Add 4-Column Section [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Click "Add 4-Column Section", then verify a new section appears with the label "4-Column Section" and fields for Section Name and Disabled.

---

## 33. Add Content to 4-Column Section [depends: #32]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 4-Column Section, click "Text Area" in each column, and verify four Text Area blocks appear.

---

## 34. Add Multiple Sections [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, then add a 2-Column Section, then add a 3-Column Section, and verify all three sections appear in order.

---

## 35. Reorder Sections [depends: #34]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section and a 2-Column Section. Use the drag handle on the 2-Column Section to move it above the 1-Column Section. Verify the order changes.

---

## 36. Remove Section [depends: #34]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section and a 2-Column Section. Click the "Remove" button on the 1-Column Section and confirm the removal. Verify only the 2-Column Section remains.

---

## 37. Remove Content Block [depends: #7]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section with a Text Area block. Click the "Remove" button on the Text Area block. Verify the block is removed from the section.

---

## 38. Duplicate Content Block [depends: #7]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section with a Text Area block containing "Original text". Click the "Duplicate" button on the Text Area block. Verify a second Text Area block appears with the same content.

---

## 39. Set Meta Tags [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Expand the "Meta Tags" section, type "Test meta description" into the Meta Description field, and verify the text appears.

---

## 40. Set Social Sharing Image [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Expand the "Social Sharing" section, click "Choose Image" in the Social Sharing Image field, and verify the image selector opens.

---

## 41. Submit Page [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Fill in the Page Title with "Submit Test Page", click the "Save" button, and verify the page is created (success message or redirect).

---

## 42. Submit Page with All Fields [depends: #34]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Fill in Page Title "Complete Page", add a 1-Column Section with a Text Area block containing "Hello World", set Meta Description "Test meta", and click Save. Verify success.

---

## 43. Cancel Page Creation [depends: #1]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Fill in the Page Title with "Cancel Test", click the "Cancel" button, and verify the form is cleared or user is redirected.

---

## 44. Validation - Empty Title [standalone]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Leave the Page Title field empty and click Save. Verify a validation error appears for the Title field.

---

## 45. Validation - Empty Section Name [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, leave Section Name empty, and click Save. Verify a validation error appears for the Section Name field.

---

## 46. Search Content Blocks [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, type "text" in the content block search field, and verify the Text Area block appears in filtered results.

---

## 47. Add Block via Search [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, type "image" in the content block search field, click the "Image" result, and verify an Image block is added.

---

## 48. Responsive Section Visibility [depends: #3]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section, check "Hide on Desktop", "Hide on Tablet", and "Hide on Mobile". Verify all three checkboxes are checked.

---

## 49. Add Content Block to Wrong Section [depends: #34]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Add a 1-Column Section and a 2-Column Section. Try to add a "Text Area" block to the 2-Column Section's Column 1. Verify it works correctly.

---

## 50. Full Workflow - Create Complete Page [depends: #1, #3, #7, #27, #30]

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Prompt:** Create a complete page: Title "Full Test Page", add 1-Column Section with Text Area "Welcome", add 2-Column Section with Image and Text Area, add 3-Column Section with three Views blocks, set Meta Description "Full test", and Save. Verify success.
